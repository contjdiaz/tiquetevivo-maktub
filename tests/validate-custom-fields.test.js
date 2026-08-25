import { describe, it, expect } from 'vitest';
import { validateCustomFields } from '../netlify/functions/_validators.js';

describe('validateCustomFields', () => {
  describe('text field type', () => {
    const definitions = [
      { field_key: 'name', display_label: 'Nombre', field_type: 'text', required: false }
    ];

    it('accepts a string value', () => {
      const result = validateCustomFields({ name: 'John' }, definitions);
      expect(result.valid).toBe(true);
    });

    it('rejects a non-string value', () => {
      const result = validateCustomFields({ name: 123 }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Nombre must be a text');
    });
  });

  describe('number field type', () => {
    const definitions = [
      { field_key: 'weight', display_label: 'Peso', field_type: 'number', required: false }
    ];

    it('accepts a numeric value', () => {
      const result = validateCustomFields({ weight: 5.5 }, definitions);
      expect(result.valid).toBe(true);
    });

    it('rejects a string value', () => {
      const result = validateCustomFields({ weight: '5.5' }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Peso must be a number');
    });

    it('rejects NaN', () => {
      const result = validateCustomFields({ weight: NaN }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Peso must be a number');
    });

    it('rejects Infinity', () => {
      const result = validateCustomFields({ weight: Infinity }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Peso must be a number');
    });
  });

  describe('date field type', () => {
    const definitions = [
      { field_key: 'delivery_date', display_label: 'Fecha de entrega', field_type: 'date', required: false }
    ];

    it('accepts a valid YYYY-MM-DD date', () => {
      const result = validateCustomFields({ delivery_date: '2024-03-15' }, definitions);
      expect(result.valid).toBe(true);
    });

    it('rejects an invalid date string', () => {
      const result = validateCustomFields({ delivery_date: 'not-a-date' }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Fecha de entrega must be a date');
    });

    it('rejects a datetime string', () => {
      const result = validateCustomFields({ delivery_date: '2024-03-15T10:30:00' }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Fecha de entrega must be a date');
    });

    it('rejects an invalid day (Feb 30)', () => {
      const result = validateCustomFields({ delivery_date: '2024-02-30' }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Fecha de entrega must be a date');
    });
  });

  describe('datetime field type', () => {
    const definitions = [
      { field_key: 'entry_time', display_label: 'Hora de entrada', field_type: 'datetime', required: false }
    ];

    it('accepts a valid ISO datetime', () => {
      const result = validateCustomFields({ entry_time: '2024-03-15T10:30:00' }, definitions);
      expect(result.valid).toBe(true);
    });

    it('accepts a datetime with timezone', () => {
      const result = validateCustomFields({ entry_time: '2024-03-15T10:30:00Z' }, definitions);
      expect(result.valid).toBe(true);
    });

    it('accepts a datetime without seconds', () => {
      const result = validateCustomFields({ entry_time: '2024-03-15T10:30' }, definitions);
      expect(result.valid).toBe(true);
    });

    it('rejects a plain date (no time component)', () => {
      const result = validateCustomFields({ entry_time: '2024-03-15' }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Hora de entrada must be a datetime');
    });

    it('rejects an invalid datetime string', () => {
      const result = validateCustomFields({ entry_time: 'not-a-datetime' }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Hora de entrada must be a datetime');
    });
  });

  describe('boolean field type', () => {
    const definitions = [
      { field_key: 'is_delicate', display_label: 'Es delicado', field_type: 'boolean', required: false }
    ];

    it('accepts true', () => {
      const result = validateCustomFields({ is_delicate: true }, definitions);
      expect(result.valid).toBe(true);
    });

    it('accepts false', () => {
      const result = validateCustomFields({ is_delicate: false }, definitions);
      expect(result.valid).toBe(true);
    });

    it('rejects a string "true"', () => {
      const result = validateCustomFields({ is_delicate: 'true' }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Es delicado must be a boolean');
    });

    it('rejects a number', () => {
      const result = validateCustomFields({ is_delicate: 1 }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Es delicado must be a boolean');
    });
  });

  describe('select field type', () => {
    const definitions = [
      { field_key: 'finishing', display_label: 'Acabado', field_type: 'select', required: false, options: ['mate', 'brillo', 'plastificado'] }
    ];

    it('accepts a value from the options list', () => {
      const result = validateCustomFields({ finishing: 'brillo' }, definitions);
      expect(result.valid).toBe(true);
    });

    it('rejects a value not in the options list', () => {
      const result = validateCustomFields({ finishing: 'satin' }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Acabado must be a select');
    });
  });

  describe('required fields', () => {
    const definitions = [
      { field_key: 'plate_number', display_label: 'Número de placa', field_type: 'text', required: true }
    ];

    it('rejects when required field is missing', () => {
      const result = validateCustomFields({}, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Número de placa is required');
    });

    it('rejects when required field is null', () => {
      const result = validateCustomFields({ plate_number: null }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Número de placa is required');
    });

    it('accepts when required field has a valid value', () => {
      const result = validateCustomFields({ plate_number: 'ABC-123' }, definitions);
      expect(result.valid).toBe(true);
    });
  });

  describe('multiple fields validation', () => {
    const definitions = [
      { field_key: 'plate_number', display_label: 'Número de placa', field_type: 'text', required: true },
      { field_key: 'entry_time', display_label: 'Hora de entrada', field_type: 'datetime', required: true },
      { field_key: 'bay_number', display_label: 'Número de bahía', field_type: 'text', required: false }
    ];

    it('collects multiple errors', () => {
      const result = validateCustomFields({}, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Número de placa is required');
      expect(result.errors).toContain('Hora de entrada is required');
    });

    it('validates all provided fields', () => {
      const result = validateCustomFields(
        { plate_number: 'ABC-123', entry_time: '2024-03-15T10:30:00', bay_number: 'A5' },
        definitions
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('time field type', () => {
    const definitions = [
      { field_key: 'hora', display_label: 'Hora de entrega', field_type: 'time', required: false }
    ];

    it('accepts a valid HH:MM time', () => {
      expect(validateCustomFields({ hora: '14:30' }, definitions).valid).toBe(true);
      expect(validateCustomFields({ hora: '00:00' }, definitions).valid).toBe(true);
      expect(validateCustomFields({ hora: '23:59' }, definitions).valid).toBe(true);
    });

    it('rejects invalid hours and minutes', () => {
      const result = validateCustomFields({ hora: '24:00' }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Hora de entrega must be a time in HH:MM format');
      expect(validateCustomFields({ hora: '12:60' }, definitions).valid).toBe(false);
    });

    it('rejects non-string and malformed values', () => {
      expect(validateCustomFields({ hora: 1430 }, definitions).valid).toBe(false);
      expect(validateCustomFields({ hora: '2pm' }, definitions).valid).toBe(false);
      expect(validateCustomFields({ hora: '14:3' }, definitions).valid).toBe(false);
    });
  });

  describe('textarea field type', () => {
    const definitions = [
      { field_key: 'productos', display_label: 'Productos', field_type: 'textarea', required: false }
    ];

    it('accepts multi-line strings', () => {
      const result = validateCustomFields(
        { productos: '2 kg de tomate\n1 libra de arracacha\n3 mangos' },
        definitions
      );
      expect(result.valid).toBe(true);
    });

    it('accepts single-line strings', () => {
      expect(validateCustomFields({ productos: '1 canasta familiar' }, definitions).valid).toBe(true);
    });

    it('rejects non-string values', () => {
      const result = validateCustomFields({ productos: 42 }, definitions);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Productos must be a text');
    });
  });

  describe('edge cases', () => {
    it('returns valid for empty definitions array', () => {
      const result = validateCustomFields({ foo: 'bar' }, []);
      expect(result.valid).toBe(true);
    });

    it('returns valid for null definitions', () => {
      const result = validateCustomFields({ foo: 'bar' }, null);
      expect(result.valid).toBe(true);
    });

    it('handles null values input gracefully', () => {
      const definitions = [
        { field_key: 'name', display_label: 'Nombre', field_type: 'text', required: false }
      ];
      const result = validateCustomFields(null, definitions);
      expect(result.valid).toBe(true);
    });

    it('handles undefined values input gracefully', () => {
      const definitions = [
        { field_key: 'name', display_label: 'Nombre', field_type: 'text', required: false }
      ];
      const result = validateCustomFields(undefined, definitions);
      expect(result.valid).toBe(true);
    });
  });
});
