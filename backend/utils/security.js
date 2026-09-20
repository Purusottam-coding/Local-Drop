/**
 * LocalDrop Security Utilities
 * - Path traversal mitigation
 * - Filename sanitization for Windows / POSIX filesystem safety
 * - Dangerous control character stripping
 */

/**
 * Sanitize untrusted filename to prevent path traversal, control character injection,
 * and dangerous OS reserved filename exploits.
 * 
 * @param {string} filename 
 * @returns {string} Sanitized safe filename
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed_file';
  }

  // 1. Strip any directory path components (both / and \)
  let clean = filename.replace(/^.*[\\\/]/, '');

  // 2. Remove null bytes and non-printable control characters
  clean = clean.replace(/[\x00-\x1f\x80-\x9f]/g, '');

  // 3. Replace forbidden Windows/POSIX filesystem characters (< > : " / \ | ? *) with an underscore
  clean = clean.replace(/[<>:"/\\|?*]/g, '_');

  // 4. Prevent relative path traversal sequences (e.g. '..')
  clean = clean.replace(/\.\.+/g, '.');

  // 5. Trim leading and trailing whitespace and periods
  clean = clean.trim().replace(/^\.+/, '').replace(/\.+$/, '');

  // 6. Check for Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const reservedRegex = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (reservedRegex.test(clean)) {
    clean = `file_${clean}`;
  }

  // 7. Enforce maximum filename length (standard 255 chars) while preserving extension if possible
  const MAX_LEN = 255;
  if (clean.length > MAX_LEN) {
    const extIndex = clean.lastIndexOf('.');
    if (extIndex !== -1 && extIndex > clean.length - 20) {
      const ext = clean.substring(extIndex);
      clean = clean.substring(0, MAX_LEN - ext.length) + ext;
    } else {
      clean = clean.substring(0, MAX_LEN);
    }
  }

  return clean || 'unnamed_file';
}

/**
 * Sanitize an array of file metadata objects
 * @param {Array} files 
 * @returns {Array} Sanitized files array
 */
function sanitizeFilesMetadata(files) {
  if (!Array.isArray(files)) return [];
  return files.map((file) => {
    if (!file || typeof file !== 'object') return file;
    return {
      ...file,
      name: sanitizeFilename(file.name || 'unnamed_file'),
      size: typeof file.size === 'number' && file.size >= 0 ? file.size : 0,
    };
  });
}

module.exports = {
  sanitizeFilename,
  sanitizeFilesMetadata,
};
