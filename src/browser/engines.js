import { fetchVerified } from '../assets.js';
import { MIN_NUM_FACES_SETTING } from '../face-count.js';
import { ResourceScope } from '../resources.js';

// Creates the three MediaPipe Tasks instances from the pinned manifest:
//   segmenter, landmarker  VIDEO mode, shared by preview and capture through the scheduler
//   auditLandmarker        IMAGE mode, used only for independent decoded-JPEG checks
// Models are fetched and hash-checked before they reach MediaPipe.
export async function createEngines(manifest, { production = false, log = () => {} } = {}) {
  const tv = manifest.client.tasksVision;
  const vision = await import(tv.bundle.url);
  const fileset = await vision.FilesetResolver.forVisionTasks(tv.wasmBaseUrl);

  const [segmenterModel, landmarkerModel] = await Promise.all([
    fetchVerified(manifest.models.selfieSegmenter, { production }),
    fetchVerified(manifest.models.faceLandmarker, { production }),
  ]);
  for (const [name, model] of [['selfieSegmenter', segmenterModel], ['faceLandmarker', landmarkerModel]]) {
    if (!model.pinned) log(`Unpinned model ${name}; observed sha256 ${model.sha256}`);
  }

  let delegate = 'GPU';
  const create = async (TaskClass, optionsFor) => {
    try {
      return await TaskClass.createFromOptions(fileset, optionsFor(delegate));
    } catch (error) {
      if (delegate !== 'GPU') throw error;
      log(`GPU delegate failed (${error.message}); falling back to CPU.`);
      delegate = 'CPU';
      return TaskClass.createFromOptions(fileset, optionsFor(delegate));
    }
  };

  const landmarkerOptions = (runningMode) => (d) => ({
    baseOptions: { modelAssetBuffer: landmarkerModel.bytes.slice(), delegate: d },
    runningMode,
    numFaces: MIN_NUM_FACES_SETTING,
    minFaceDetectionConfidence: 0.7,
    minFacePresenceConfidence: 0.7,
    minTrackingConfidence: 0.7,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });

  const scope = new ResourceScope();
  try {
    const engines = {
      segmenter: scope.adopt(
        await create(vision.ImageSegmenter, (d) => ({
          baseOptions: { modelAssetBuffer: segmenterModel.bytes.slice(), delegate: d },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        })),
      ),
      landmarker: scope.adopt(await create(vision.FaceLandmarker, landmarkerOptions('VIDEO'))),
      auditLandmarker: scope.adopt(await create(vision.FaceLandmarker, landmarkerOptions('IMAGE'))),
    };
    for (const engine of Object.values(engines)) scope.transfer(engine);
    const models = {
      selfieSegmenter: { sha256: segmenterModel.sha256, pinned: segmenterModel.pinned },
      faceLandmarker: { sha256: landmarkerModel.sha256, pinned: landmarkerModel.pinned },
    };
    return { engines, delegate, models };
  } finally {
    // Closes engines only when creation failed part-way; successful ones were transferred.
    scope.releaseAll();
  }
}
