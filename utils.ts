export function isObject(item: any): item is Record<string, any> {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

export function assignNested(target: Record<string, any>, source: Record<string, any>): void {
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
