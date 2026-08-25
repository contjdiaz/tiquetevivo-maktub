/**
 * Shared validation module for TiqueteVivo API endpoints.
 * All validators return { valid: boolean, error?: string, value?: any }.
 */

const ALLOWED_STATUSES = ['RECEIVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'];

/**
 * Validates and normalizes a phone number.
 * Strips +, spaces, and dashes, then checks for 10-15 digits.
 * @param {string} phone - Raw phone input
 * @returns {{ valid: boolean, value?: string, error?: string }}
 */
export function validatePhone(phone) {
  if (phone == null || typeof phone !== 'string') {
    return { valid: false, error: 'Phone number is required and must be a string' };
  }

  // Strip +, spaces, and dashes
  const normalized = phone.replace(/[+\s\-]/g, '');

  // Check that the result is digits only
  if (!/^\d+$/.test(normalized)) {
    return { valid: false, error: 'Phone number must contain only digits (after removing +, spaces, and dashes)' };
  }

  // Check length: 10-15 digits
  if (normalized.length < 10 || normalized.length > 15) {
    return { valid: false, error: 'Phone number must be between 10 and 15 digits' };
  }

  return { valid: true, value: normalized };
}

/**
 * Validates a monetary amount value.
 * Checks non-negative, finite, and max 99999999.99.
 * @param {*} value - The amount value to validate
 * @param {string} fieldName - Name of the field for error messages
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
export function validateAmount(value, fieldName) {
  if (value == null) {
    return { valid: false, error: `${fieldName} is required` };
  }

  const num = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(num)) {
    return { valid: false, error: `${fieldName} must be a finite number` };
  }

  if (num < 0) {
    return { valid: false, error: `${fieldName} must be non-negative` };
  }

  if (num > 99999999.99) {
    return { valid: false, error: `${fieldName} must not exceed 99,999,999.99` };
  }

  return { valid: true, value: num };
}

/**
 * Validates an order status against the allowed enum values.
 * @param {string} status - The status to validate
 * @returns {{ valid: boolean, value?: string, error?: string }}
 */
export function validateStatus(status) {
  if (status == null || typeof status !== 'string') {
    return { valid: false, error: 'Status is required and must be a string' };
  }

  const upper = status.toUpperCase();

  if (!ALLOWED_STATUSES.includes(upper)) {
    return {
      valid: false,
      error: `Status must be one of: ${ALLOWED_STATUSES.join(', ')}. Received: "${status}"`
    };
  }

  return { valid: true, value: upper };
}

/**
 * Validates that required fields are present and non-empty in the request body.
 * @param {object} body - The request body object
 * @param {string[]} fields - Array of required field names
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateRequired(body, fields) {
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const errors = [];

  for (const field of fields) {
    const value = body[field];
    if (value == null || (typeof value === 'string' && value.trim() === '')) {
      errors.push(`${field} is required and must not be empty`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Validates that a status exists in the business status flow (case-insensitive).
 * @param {string} status - Status to validate
 * @param {StatusFlowEntry[]} statusFlow - Array of { status_key, display_label }
 * @returns {{ valid: boolean, value?: string, error?: string }}
 */
export function validateStatusInFlow(status, statusFlow) {
  if (status == null || typeof status !== 'string') {
    return { valid: false, error: 'Status is required and must be a string' };
  }

  if (!Array.isArray(statusFlow) || statusFlow.length === 0) {
    return { valid: false, error: 'Status flow configuration is required' };
  }

  const upper = status.toUpperCase();
  const match = statusFlow.find(entry => entry.status_key.toUpperCase() === upper);

  if (!match) {
    const validStatuses = statusFlow.map(entry => entry.status_key).join(', ');
    return {
      valid: false,
      error: `Status must be one of: ${validStatuses}. Received: '${status}'`
    };
  }

  return { valid: true, value: match.status_key };
}

/**
 * Validates a status transition against the business status flow.
 * A transition is valid only if the target is the next sequential step
 * or the CANCELLED status.
 * @param {string} currentStatus - Current order status
 * @param {string} targetStatus - Desired new status
 * @param {StatusFlowEntry[]} statusFlow - Array of { status_key, display_label }
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateStatusTransition(currentStatus, targetStatus, statusFlow) {
  if (!Array.isArray(statusFlow) || statusFlow.length === 0) {
    return { valid: false, error: 'Status flow configuration is required' };
  }

  // Validate both statuses exist in the flow (or target is CANCELLED)
  const currentUpper = currentStatus.toUpperCase();
  const targetUpper = targetStatus.toUpperCase();

  const currentIndex = statusFlow.findIndex(
    entry => entry.status_key.toUpperCase() === currentUpper
  );

  if (currentIndex === -1) {
    const validStatuses = statusFlow.map(entry => entry.status_key).join(', ');
    return {
      valid: false,
      error: `Status must be one of: ${validStatuses}. Received: '${currentStatus}'`
    };
  }

  // CANCELLED is always a valid target regardless of current position
  if (targetUpper === 'CANCELLED') {
    return { valid: true };
  }

  const targetIndex = statusFlow.findIndex(
    entry => entry.status_key.toUpperCase() === targetUpper
  );

  if (targetIndex === -1) {
    const validStatuses = statusFlow.map(entry => entry.status_key).join(', ');
    return {
      valid: false,
      error: `Status must be one of: ${validStatuses}. Received: '${targetStatus}'`
    };
  }

  // Valid transition: target must be next sequential step (currentIndex + 1)
  if (targetIndex === currentIndex + 1) {
    return { valid: true };
  }

  // Invalid transition — determine the next valid status for the error message
  const nextIndex = currentIndex + 1;
  const nextStatus = nextIndex < statusFlow.length
    ? statusFlow[nextIndex].status_key
    : 'CANCELLED';

  return {
    valid: false,
    error: `Cannot transition from ${statusFlow[currentIndex].status_key} to ${statusFlow[targetIndex].status_key}. Next valid: ${nextStatus}`
  };
}

/**
 * Validates a string as a valid date (YYYY-MM-DD format).
 * @param {string} value
 * @returns {boolean}
 */
function isValidDate(value) {
  if (typeof value !== 'string') return false;
  // Check format: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  if (isNaN(date.getTime())) return false;
  // Verify the parsed date matches input (catches invalid days like 02-30)
  const [year, month, day] = value.split('-').map(Number);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day;
}

/**
 * Validates a string as a valid datetime (ISO 8601 compatible).
 * Accepts formats like YYYY-MM-DDTHH:mm, YYYY-MM-DDTHH:mm:ss, with optional timezone.
 * @param {string} value
 * @returns {boolean}
 */
function isValidDatetime(value) {
  if (typeof value !== 'string') return false;
  // Must contain date and time separated by T
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Validates custom field values against their type definitions.
 * @param {object} values - Key-value map of custom field data
 * @param {CustomFieldDef[]} definitions - Field definitions from business config
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateCustomFields(values, definitions) {
  if (!definitions || !Array.isArray(definitions) || definitions.length === 0) {
    return { valid: true };
  }

  const safeValues = values || {};
  const errors = [];

  for (const def of definitions) {
    const { field_key, display_label, field_type, required, options } = def;
    const value = safeValues[field_key];

    // Check required fields
    if (required && (value === undefined || value === null)) {
      errors.push(`${display_label} is required`);
      continue;
    }

    // Skip validation if value is not provided and field is not required
    if (value === undefined || value === null) {
      continue;
    }

    // Type validation
    switch (field_type) {
      case 'text':
        if (typeof value !== 'string') {
          errors.push(`${display_label} must be a text`);
        }
        break;

      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`${display_label} must be a number`);
        }
        break;

      case 'date':
        if (!isValidDate(value)) {
          errors.push(`${display_label} must be a date`);
        }
        break;

      case 'datetime':
        if (!isValidDatetime(value)) {
          errors.push(`${display_label} must be a datetime`);
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${display_label} must be a boolean`);
        }
        break;

      case 'select':
        if (!Array.isArray(options) || !options.includes(value)) {
          errors.push(`${display_label} must be a select`);
        }
        break;

      case 'time':
        if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
          errors.push(`${display_label} must be a time in HH:MM format`);
        }
        break;

      case 'textarea':
        if (typeof value !== 'string') {
          errors.push(`${display_label} must be a text`);
        }
        break;

      default:
        break;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}
