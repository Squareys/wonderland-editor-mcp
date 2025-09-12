export function isObject(item: any): item is Record<string, any> {
  return item && typeof item === "object" && !Array.isArray(item);
}

export function assignNested(
  target: Record<string, any>,
  source: Record<string, any>
): void {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (isObject(source[key]) && isObject(target[key])) {
        assignNested(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
}
/*
export function assignNested(target: any, source: any): void {
  for (const key in source) if (Object.prototype.hasOwnProperty.call(source, key)) {
    const src = source[key];
    const dst = target[key]; // triggers interceptor getter

    if (src && typeof src === 'object' && dst && typeof dst === 'object' && !Array.isArray(src) && !Array.isArray(dst)) {
      assignNested(dst, src);
    } else {
      // Only set if the key is known on target (respects defaults via `in`)
      if (!(key in target)) throw new Error(`Unknown path: ${String(key)}`);
      const ok = Reflect.set(target, key, src);   // observe success without creating real props
      if (!ok) throw new TypeError(`Cannot set ${String(key)}`);
    }
  }
}
*/

/**
 * Assigns properties to a component, ensuring type and length consistency.
 *
 * @param typeName Name of the component type
 * @param comp Component properties
 * @param properties Properties to assign to the component
 * @param o Object containing the component
 */
export function assignComponentProperties(
  typeName: string,
  comp: any,
  properties: Record<string, any>,
  o: { name: string },
  index: number = 0
) {
  for (const key of Object.keys(comp)) {
    if (key in properties) {
      if (typeof comp[key] !== typeof properties[key]) {
        throw new Error(
          `Type mismatch for property ${key} in component ${
            comp.type
          } of object ${o.name}. Expected ${typeof comp[
            key
          ]}, got ${typeof properties[key]}`
        );
      }
      if (
        Array.isArray(comp[key]) &&
        properties[key].length !== comp[key].length
      ) {
        throw new Error(
          `Length mismatch for property '${key}' in '${typeName}' component with index ${index} of object "${o.name}". Expected length ${comp[key].length}, got ${properties[key].length}`
        );
      }
      comp[key] = properties[key];
    }
  }
}

/**
 * Filters the properties of an object based on the provided filters.
 * @param filters List of property paths to filter by, e.g. "physx.enabled"
 */
export function filterObjectProperties(
  filters: string[] | undefined,
  o: any
): any {
  if (!filters || filters.length === 0) {
    return o;
  }

  const result: Record<string, any> = {};
  for (const filter of filters) {
    const keys = filter.split(".");

    // First, validate that the entire path exists on the source object
    let src: any = o;
    let valid = true;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (src == null || !(key in src)) {
        valid = false;
        break;
      }
      if (i < keys.length - 1) src = src[key];
    }
    if (!valid) continue; // Skip non-existent paths entirely

    // Re-traverse to build the result path and assign the leaf value
    let dst: any = result;
    src = o;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (i === keys.length - 1) {
        dst[key] = src[key];
      } else {
        if (!(key in dst)) dst[key] = {};
        dst = dst[key];
        src = src[key];
      }
    }
  }
  return result;
}
