// Ownership scope for closable resources (ImageBitmap, MPMask, ImageSegmenterResult, engines).
// Release is LIFO and every release is attempted even when an earlier one throws.

const defaultRelease = (resource) => resource.close();

export class ResourceScope {
  #entries = [];

  adopt(resource, release = defaultRelease) {
    if (resource != null) this.#entries.push({ resource, release });
    return resource;
  }

  // Hands ownership to another owner (a returned bundle, a worker transfer) without closing.
  transfer(resource) {
    const index = this.#entries.findIndex((entry) => entry.resource === resource);
    if (index === -1) throw new Error('ResourceScope: resource is not owned by this scope.');
    this.#entries.splice(index, 1);
    return resource;
  }

  get size() {
    return this.#entries.length;
  }

  // Returns release errors instead of throwing so callers can aggregate them.
  releaseAll() {
    const errors = [];
    for (const { resource, release } of this.#entries.splice(0).reverse()) {
      try {
        release(resource);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }
}
