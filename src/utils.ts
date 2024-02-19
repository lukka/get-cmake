/**
 * Compute an unique number given some text.
 * @param {string} text
 * @returns {number}
 */
export function hashCode(text: string): number {
    let hash = 0;
    if (text.length != 0) {
      for (let i = 0; i < text.length; i++) {
        const char: number = text.charCodeAt(i);
        hash = ((hash << 5) + hash) + char;
        hash |= 0;
      }
    }
  
    return hash;
  }
  