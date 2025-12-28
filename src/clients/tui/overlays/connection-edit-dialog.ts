/**
 * Connection Edit Dialog
 *
 * Form dialog for creating and editing database connections.
 * Supports PostgreSQL and Supabase connection types.
 */

import { PromiseDialog, type DialogConfig, type DialogResult } from './promise-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { KeyEvent, MouseEvent as TuiMouseEvent } from '../types.ts';
import type { ScreenBuffer } from '../rendering/buffer.ts';
import type { ConnectionConfig } from '../../../services/database/types.ts';

// ============================================
// Types
// ============================================

/**
 * Field definition for the form.
 */
interface FormField {
  key: ConnectionFormFieldName;
  label: string;
  type: 'text' | 'number' | 'password' | 'select' | 'boolean';
  required?: boolean;
  placeholder?: string;
  options?: string[]; // For select type
  hidden?: (data: ConnectionFormData) => boolean;
}

/**
 * Form data for connection editing.
 */
/**
 * Field names for the connection form.
 */
type ConnectionFormFieldName =
  | 'name'
  | 'type'
  | 'host'
  | 'port'
  | 'database'
  | 'username'
  | 'password'
  | 'ssl'
  | 'sslAllowSelfSigned'
  | 'readOnly'
  | 'scope'
  | 'supabaseUrl'
  | 'supabaseKey';

interface ConnectionFormData {
  name: string;
  type: 'postgres' | 'supabase';
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  sslAllowSelfSigned: boolean;
  readOnly: boolean;
  scope: 'global' | 'project';
  // Supabase-specific
  supabaseUrl: string;
  supabaseKey: string;
}

/**
 * Options for showing the dialog.
 */
export interface ConnectionEditDialogOptions extends DialogConfig {
  /** Existing connection to edit (null for new) */
  existingConnection?: ConnectionConfig | null;
  /** Password for existing connection (from secret service) */
  existingPassword?: string;
  /** Supabase key for existing connection */
  existingSupabaseKey?: string;
  /** Current project path (for project-scoped connections) */
  projectPath?: string;
}

/**
 * Result of the dialog.
 */
export interface ConnectionEditResult {
  /** Connection config (without secrets) */
  config: ConnectionConfig;
  /** Password to store in secret service (optional for passwordless connections) */
  password?: string;
  /** Supabase key (if applicable) */
  supabaseKey?: string;
}

// ============================================
// Form Field Definitions
// ============================================

const FORM_FIELDS: FormField[] = [
  { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'My Database' },
  { key: 'type', label: 'Type', type: 'select', required: true, options: ['postgres', 'supabase'] },
  { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'localhost' },
  { key: 'port', label: 'Port', type: 'number', required: true, placeholder: '5432' },
  { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'postgres' },
  { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'postgres' },
  { key: 'password', label: 'Password', type: 'password', required: false, placeholder: '(optional)' },
  { key: 'supabaseUrl', label: 'Supabase URL', type: 'text', placeholder: 'https://xxx.supabase.co', hidden: (d) => d.type !== 'supabase' },
  { key: 'supabaseKey', label: 'Supabase Key', type: 'password', hidden: (d) => d.type !== 'supabase' },
  { key: 'ssl', label: 'Use SSL', type: 'boolean' },
  { key: 'sslAllowSelfSigned', label: 'Allow Self-Signed', type: 'boolean', hidden: (d) => !d.ssl },
  { key: 'readOnly', label: 'Read Only', type: 'boolean' },
  { key: 'scope', label: 'Scope', type: 'select', options: ['global', 'project'] },
];

// ============================================
// Connection Edit Dialog
// ============================================

export class ConnectionEditDialog extends PromiseDialog<ConnectionEditResult> {
  /** Form data */
  private formData: ConnectionFormData = this.getDefaultFormData();

  /** Currently focused field index */
  private focusedFieldIndex = 0;

  /** Cursor position in text fields */
  private cursorPos = 0;

  /** Validation errors */
  private errors: Map<string, string> = new Map();

  /** Whether we're editing an existing connection */
  private isEditing = false;

  /** Connection ID when editing */
  private connectionId?: string;

  /** Project path for project-scoped connections */
  private projectPath?: string;

  /** Scroll offset for long forms */
  private scrollOffset = 0;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
    this.zIndex = 250;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the dialog for creating/editing a connection.
   */
  showForConnection(options: ConnectionEditDialogOptions = {}): Promise<DialogResult<ConnectionEditResult>> {
    this.isEditing = !!options.existingConnection;
    this.projectPath = options.projectPath;
    this.errors.clear();
    this.scrollOffset = 0;
    this.focusedFieldIndex = 0;
    this.cursorPos = 0;

    if (options.existingConnection) {
      // Editing existing connection
      this.connectionId = options.existingConnection.id;

      // Extract SSL settings from existing config
      const sslConfig = options.existingConnection.ssl;
      const sslEnabled = !!sslConfig;
      // If ssl is an object, check if rejectUnauthorized is false (meaning allow self-signed)
      const allowSelfSigned = typeof sslConfig === 'object' && sslConfig !== null
        ? sslConfig.rejectUnauthorized === false
        : false;

      this.formData = {
        name: options.existingConnection.name,
        type: options.existingConnection.type,
        host: options.existingConnection.host,
        port: String(options.existingConnection.port),
        database: options.existingConnection.database,
        username: options.existingConnection.username,
        password: options.existingPassword || '',
        ssl: sslEnabled,
        sslAllowSelfSigned: allowSelfSigned,
        readOnly: !!options.existingConnection.readOnly,
        scope: options.existingConnection.scope,
        supabaseUrl: options.existingConnection.supabaseUrl || '',
        supabaseKey: options.existingSupabaseKey || '',
      };
    } else {
      // New connection
      this.connectionId = undefined;
      this.formData = this.getDefaultFormData();
    }

    // Set cursor at end of first field
    this.cursorPos = this.formData.name.length;

    return this.showAsync({
      title: this.isEditing ? 'Edit Connection' : 'New Connection',
      width: options.width ?? 60,
      height: options.height ?? 20,
      ...options,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Form Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private getDefaultFormData(): ConnectionFormData {
    return {
      name: '',
      type: 'postgres',
      host: 'localhost',
      port: '5432',
      database: 'postgres',
      username: 'postgres',
      password: '',
      ssl: false, // Default to false for local development; enable for remote/production
      sslAllowSelfSigned: false,
      readOnly: false,
      scope: 'global',
      supabaseUrl: '',
      supabaseKey: '',
    };
  }

  /**
   * Get a form field value.
   */
  private getFieldValue(key: ConnectionFormFieldName): string | boolean {
    return this.formData[key];
  }

  /**
   * Set a form field value.
   */
  private setFieldValue(key: ConnectionFormFieldName, value: string | boolean): void {
    // Use type assertion for dynamic property access
    (this.formData as Record<ConnectionFormFieldName, string | boolean>)[key] = value;
  }

  /**
   * Clear error for a field.
   */
  private clearFieldError(key: ConnectionFormFieldName): void {
    this.errors.delete(key as string);
  }

  /**
   * Set error for a field.
   */
  private setFieldError(key: ConnectionFormFieldName, message: string): void {
    this.errors.set(key as string, message);
  }

  /**
   * Get error for a field.
   */
  private getFieldError(key: ConnectionFormFieldName): string | undefined {
    return this.errors.get(key as string);
  }

  private getVisibleFields(): FormField[] {
    return FORM_FIELDS.filter(f => !f.hidden || !f.hidden(this.formData));
  }

  private getCurrentField(): FormField | undefined {
    return this.getVisibleFields()[this.focusedFieldIndex];
  }

  private validate(): boolean {
    this.errors.clear();

    const visibleFields = this.getVisibleFields();
    for (const field of visibleFields) {
      const value = this.getFieldValue(field.key);

      // Required field check
      if (field.required) {
        if (value === '' || value === undefined) {
          this.setFieldError(field.key, `${field.label} is required`);
        }
      }

      // Port validation
      if (field.key === 'port' && value) {
        const port = parseInt(String(value), 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          this.setFieldError('port', 'Port must be 1-65535');
        }
      }

      // URL validation for Supabase
      if (field.key === 'supabaseUrl' && value && this.formData.type === 'supabase') {
        if (!String(value).startsWith('https://')) {
          this.setFieldError('supabaseUrl', 'Must start with https://');
        }
      }
    }

    return this.errors.size === 0;
  }

  private buildResult(): ConnectionEditResult {
    const port = parseInt(this.formData.port, 10) || 5432;
    const hasPassword = this.formData.password.trim().length > 0;
    const passwordSecretKey = hasPassword ? `database.${this.connectionId || 'new'}.password` : undefined;

    // Build SSL config
    // - If SSL is disabled: false
    // - If SSL is enabled but allow self-signed is off: true (default SSL)
    // - If SSL is enabled and allow self-signed is on: { rejectUnauthorized: false }
    let sslConfig: boolean | { rejectUnauthorized: boolean } = false;
    if (this.formData.ssl) {
      sslConfig = this.formData.sslAllowSelfSigned
        ? { rejectUnauthorized: false }
        : true;
    }

    const config: ConnectionConfig = {
      id: this.connectionId,
      name: this.formData.name.trim(),
      type: this.formData.type,
      host: this.formData.host.trim(),
      port,
      database: this.formData.database.trim(),
      username: this.formData.username.trim(),
      passwordSecret: passwordSecretKey,
      ssl: sslConfig,
      readOnly: this.formData.readOnly,
      scope: this.formData.scope,
      projectPath: this.formData.scope === 'project' ? this.projectPath : undefined,
    };

    // Add Supabase-specific fields
    if (this.formData.type === 'supabase') {
      config.supabaseUrl = this.formData.supabaseUrl.trim();
      config.supabaseKeySecret = `database.${this.connectionId || 'new'}.supabase-key`;
    }

    return {
      config,
      password: hasPassword ? this.formData.password : undefined,
      supabaseKey: this.formData.type === 'supabase' ? this.formData.supabaseKey : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Handling
  // ─────────────────────────────────────────────────────────────────────────

  protected override handleKeyInput(event: KeyEvent): boolean {
    const field = this.getCurrentField();
    if (!field) return false;

    // Navigation between fields
    if (event.key === 'Tab' && !event.shift) {
      this.focusNextField();
      return true;
    }
    if (event.key === 'Tab' && event.shift) {
      this.focusPrevField();
      return true;
    }
    if (event.key === 'ArrowDown' && !this.isTextField(field)) {
      this.focusNextField();
      return true;
    }
    if (event.key === 'ArrowUp' && !this.isTextField(field)) {
      this.focusPrevField();
      return true;
    }

    // Enter to confirm (when not in text field or on last field)
    if (event.key === 'Enter') {
      if (event.ctrl || this.focusedFieldIndex === this.getVisibleFields().length - 1) {
        this.submitForm();
        return true;
      } else if (!this.isTextField(field)) {
        this.focusNextField();
        return true;
      }
    }

    // Handle field-specific input
    switch (field.type) {
      case 'text':
      case 'number':
      case 'password':
        return this.handleTextInput(event, field);
      case 'select':
        return this.handleSelectInput(event, field);
      case 'boolean':
        return this.handleBooleanInput(event, field);
    }

    return false;
  }

  private isTextField(field: FormField): boolean {
    return field.type === 'text' || field.type === 'number' || field.type === 'password';
  }

  private handleTextInput(event: KeyEvent, field: FormField): boolean {
    const value = String(this.getFieldValue(field.key) || '');

    // Cursor movement
    if (event.key === 'ArrowLeft') {
      this.cursorPos = Math.max(0, this.cursorPos - 1);
      this.callbacks.onDirty();
      return true;
    }
    if (event.key === 'ArrowRight') {
      this.cursorPos = Math.min(value.length, this.cursorPos + 1);
      this.callbacks.onDirty();
      return true;
    }
    if (event.key === 'Home') {
      this.cursorPos = 0;
      this.callbacks.onDirty();
      return true;
    }
    if (event.key === 'End') {
      this.cursorPos = value.length;
      this.callbacks.onDirty();
      return true;
    }

    // Deletion
    if (event.key === 'Backspace') {
      if (this.cursorPos > 0) {
        const newValue = value.slice(0, this.cursorPos - 1) + value.slice(this.cursorPos);
        this.setFieldValue(field.key, newValue);
        this.cursorPos--;
        this.clearFieldError(field.key);
        this.callbacks.onDirty();
      }
      return true;
    }
    if (event.key === 'Delete') {
      if (this.cursorPos < value.length) {
        const newValue = value.slice(0, this.cursorPos) + value.slice(this.cursorPos + 1);
        this.setFieldValue(field.key, newValue);
        this.clearFieldError(field.key);
        this.callbacks.onDirty();
      }
      return true;
    }

    // Clear line
    if (event.ctrl && event.key === 'u') {
      this.setFieldValue(field.key, '');
      this.cursorPos = 0;
      this.clearFieldError(field.key);
      this.callbacks.onDirty();
      return true;
    }

    // Character input
    if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      // For number fields, only allow digits
      if (field.type === 'number' && !/^\d$/.test(event.key)) {
        return true;
      }

      const newValue = value.slice(0, this.cursorPos) + event.key + value.slice(this.cursorPos);
      this.setFieldValue(field.key, newValue);
      this.cursorPos++;
      this.clearFieldError(field.key);
      this.callbacks.onDirty();
      return true;
    }

    return false;
  }

  private handleSelectInput(event: KeyEvent, field: FormField): boolean {
    const options = field.options || [];
    const currentValue = String(this.getFieldValue(field.key));
    const currentIndex = options.indexOf(currentValue);

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      const newIndex = (currentIndex - 1 + options.length) % options.length;
      const newValue = options[newIndex];
      if (newValue !== undefined) this.setFieldValue(field.key, newValue);
      this.callbacks.onDirty();
      return true;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      const newIndex = (currentIndex + 1) % options.length;
      const newValue = options[newIndex];
      if (newValue !== undefined) this.setFieldValue(field.key, newValue);
      this.callbacks.onDirty();
      return true;
    }
    if (event.key === ' ') {
      const newIndex = (currentIndex + 1) % options.length;
      const newValue = options[newIndex];
      if (newValue !== undefined) this.setFieldValue(field.key, newValue);
      this.callbacks.onDirty();
      return true;
    }

    return false;
  }

  private handleBooleanInput(event: KeyEvent, field: FormField): boolean {
    if (event.key === ' ' || event.key === 'Enter') {
      const currentValue = !!this.getFieldValue(field.key);
      this.setFieldValue(field.key, !currentValue);
      this.callbacks.onDirty();
      return true;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const currentValue = !!this.getFieldValue(field.key);
      this.setFieldValue(field.key, !currentValue);
      this.callbacks.onDirty();
      return true;
    }

    return false;
  }

  private focusNextField(): void {
    const visibleFields = this.getVisibleFields();
    this.focusedFieldIndex = Math.min(visibleFields.length - 1, this.focusedFieldIndex + 1);
    this.updateCursorForField();
    this.ensureFieldVisible();
    this.callbacks.onDirty();
  }

  private focusPrevField(): void {
    this.focusedFieldIndex = Math.max(0, this.focusedFieldIndex - 1);
    this.updateCursorForField();
    this.ensureFieldVisible();
    this.callbacks.onDirty();
  }

  private updateCursorForField(): void {
    const field = this.getCurrentField();
    if (field && this.isTextField(field)) {
      const value = String(this.getFieldValue(field.key) || '');
      this.cursorPos = value.length;
    }
  }

  private ensureFieldVisible(): void {
    const content = this.getContentBounds();
    const maxVisibleFields = content.height - 4; // Leave room for header and footer

    if (this.focusedFieldIndex < this.scrollOffset) {
      this.scrollOffset = this.focusedFieldIndex;
    } else if (this.focusedFieldIndex >= this.scrollOffset + maxVisibleFields) {
      this.scrollOffset = this.focusedFieldIndex - maxVisibleFields + 1;
    }
  }

  private submitForm(): void {
    if (this.validate()) {
      this.confirm(this.buildResult());
    } else {
      this.callbacks.onDirty();
    }
  }

  protected override handleMouseInput(event: TuiMouseEvent): boolean {
    if (event.type !== 'press') return true;

    const content = this.getContentBounds();
    const visibleFields = this.getVisibleFields();
    const fieldStartY = content.y + 2;

    // Check if clicking on a field row
    for (let i = 0; i < visibleFields.length; i++) {
      const fieldY = fieldStartY + i - this.scrollOffset;
      if (event.y === fieldY && fieldY >= content.y && fieldY < content.y + content.height - 2) {
        this.focusedFieldIndex = i;
        this.updateCursorForField();
        this.callbacks.onDirty();
        return true;
      }
    }

    // Check button clicks
    const buttonY = content.y + content.height - 1;
    if (event.y === buttonY) {
      const cancelX = content.x + content.width - 20;
      const saveX = content.x + content.width - 10;

      if (event.x >= saveX && event.x < saveX + 8) {
        this.submitForm();
        return true;
      }
      if (event.x >= cancelX && event.x < cancelX + 8) {
        this.cancel();
        return true;
      }
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────────────

  protected override renderContent(buffer: ScreenBuffer): void {
    const content = this.getContentBounds();
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const focusBorder = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const errorFg = this.callbacks.getThemeColor('errorForeground', '#f44336');
    const successFg = this.callbacks.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');

    const visibleFields = this.getVisibleFields();
    const labelWidth = 14;
    let y = content.y + 1;

    // Render fields
    const maxVisibleFields = content.height - 4;
    const endIndex = Math.min(visibleFields.length, this.scrollOffset + maxVisibleFields);

    for (let i = this.scrollOffset; i < endIndex; i++) {
      const field = visibleFields[i]!;
      const isFocused = i === this.focusedFieldIndex;
      const value = this.getFieldValue(field.key);
      const error = this.getFieldError(field.key);

      // Label
      const label = field.label + (field.required ? '*' : '') + ':';
      buffer.writeString(content.x, y, label.padEnd(labelWidth), isFocused ? fg : dimFg, bg);

      // Value area
      const valueX = content.x + labelWidth;
      const valueWidth = content.width - labelWidth - 1;

      if (field.type === 'text' || field.type === 'number' || field.type === 'password') {
        this.renderTextField(buffer, valueX, y, valueWidth, field, String(value || ''), isFocused, error);
      } else if (field.type === 'select') {
        this.renderSelectField(buffer, valueX, y, valueWidth, field, String(value), isFocused);
      } else if (field.type === 'boolean') {
        this.renderBooleanField(buffer, valueX, y, valueWidth, !!value, isFocused);
      }

      y++;
    }

    // Scroll indicator
    if (visibleFields.length > maxVisibleFields) {
      const scrollInfo = `${this.scrollOffset + 1}-${endIndex}/${visibleFields.length}`;
      buffer.writeString(content.x + content.width - scrollInfo.length - 1, content.y, scrollInfo, dimFg, bg);
    }

    // Error summary
    if (this.errors.size > 0) {
      const errorY = content.y + content.height - 2;
      const errorMsg = `${this.errors.size} error(s) - fix before saving`;
      buffer.writeString(content.x, errorY, errorMsg, errorFg, bg);
    }

    // Footer buttons
    const footerY = content.y + content.height - 1;
    const saveLabel = this.isEditing ? ' Save ' : ' Create ';
    const cancelLabel = ' Cancel ';

    // Cancel button
    const cancelX = content.x + content.width - cancelLabel.length - saveLabel.length - 2;
    buffer.writeString(cancelX, footerY, cancelLabel, fg, dimFg);

    // Save button
    const saveX = content.x + content.width - saveLabel.length - 1;
    buffer.writeString(saveX, footerY, saveLabel, bg, focusBorder);

    // Hints
    buffer.writeString(content.x, footerY, 'Tab: next | Ctrl+Enter: save', dimFg, bg);
  }

  private renderTextField(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    field: FormField,
    value: string,
    isFocused: boolean,
    error?: string
  ): void {
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const inputBg = this.callbacks.getThemeColor('input.background', '#3c3c3c');
    const fg = this.callbacks.getThemeColor('input.foreground', '#cccccc');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');
    const focusBorder = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const errorBorder = this.callbacks.getThemeColor('inputValidation.errorBorder', '#f44336');

    const borderColor = error ? errorBorder : (isFocused ? focusBorder : inputBg);

    // Draw input background
    for (let i = 0; i < width; i++) {
      buffer.set(x + i, y, { char: ' ', fg, bg: inputBg });
    }

    // Display value or placeholder
    let displayValue = value;
    let displayFg = fg;

    if (!value && field.placeholder) {
      displayValue = field.placeholder;
      displayFg = dimFg;
    } else if (field.type === 'password' && value) {
      displayValue = '•'.repeat(value.length);
    }

    // Truncate if too long
    const maxDisplay = width - 2;
    let scrollOffset = 0;
    if (isFocused && this.cursorPos > maxDisplay - 1) {
      scrollOffset = this.cursorPos - maxDisplay + 1;
    }
    const visibleValue = displayValue.slice(scrollOffset, scrollOffset + maxDisplay);

    buffer.writeString(x + 1, y, visibleValue, displayFg, inputBg);

    // Cursor
    if (isFocused) {
      const cursorX = x + 1 + this.cursorPos - scrollOffset;
      if (cursorX < x + width - 1) {
        const cursorChar = this.cursorPos < value.length
          ? (field.type === 'password' ? '•' : value[this.cursorPos])
          : ' ';
        buffer.set(cursorX, y, { char: cursorChar || ' ', fg: inputBg, bg: focusBorder });
      }
    }

    // Focus/error border indicator
    buffer.set(x, y, { char: isFocused ? '▸' : ' ', fg: borderColor, bg });
  }

  private renderSelectField(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    field: FormField,
    value: string,
    isFocused: boolean
  ): void {
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');
    const focusBorder = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');

    const displayStr = isFocused ? `◄ ${value} ►` : value;
    const displayFg = isFocused ? focusBorder : fg;

    buffer.writeString(x, y, displayStr, displayFg, bg);
  }

  private renderBooleanField(
    buffer: ScreenBuffer,
    x: number,
    y: number,
    width: number,
    value: boolean,
    isFocused: boolean
  ): void {
    const bg = this.callbacks.getThemeColor('editorWidget.background', '#252526');
    const fg = this.callbacks.getThemeColor('editorWidget.foreground', '#cccccc');
    const focusBorder = this.callbacks.getThemeColor('focusBorder', '#007acc');
    const successFg = this.callbacks.getThemeColor('gitDecoration.addedResourceForeground', '#81b88b');
    const dimFg = this.callbacks.getThemeColor('descriptionForeground', '#888888');

    const checkbox = value ? '[✓]' : '[ ]';
    const displayFg = value ? successFg : (isFocused ? focusBorder : dimFg);

    buffer.writeString(x, y, checkbox, displayFg, bg);
  }
}

/**
 * Create a connection edit dialog instance.
 */
export function createConnectionEditDialog(
  callbacks: OverlayManagerCallbacks
): ConnectionEditDialog {
  return new ConnectionEditDialog('connection-edit', callbacks);
}

export default ConnectionEditDialog;
