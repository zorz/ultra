/**
 * Connection Picker Dialog
 *
 * Overlay for selecting a database connection.
 * Features:
 * - List of available connections with status
 * - Quick filter by name
 * - Option to create new connection
 * - Shows connection status (connected/disconnected/error)
 */

import { SearchableDialog, type ItemDisplay } from './searchable-dialog.ts';
import type { OverlayManagerCallbacks } from './overlay-manager.ts';
import type { ConnectionInfo } from '../../../services/database/types.ts';

// ============================================
// Types
// ============================================

/**
 * Connection picker result.
 */
export type ConnectionPickerResult = ConnectionInfo | 'new' | null;

// ============================================
// Connection Picker Dialog
// ============================================

/**
 * Promise-based connection picker with search.
 */
export class ConnectionPickerDialog extends SearchableDialog<ConnectionInfo | 'new'> {
  /** Currently selected connection ID (for highlighting) */
  private currentConnectionId: string | null = null;

  constructor(id: string, callbacks: OverlayManagerCallbacks) {
    super(id, callbacks);
    this.zIndex = 200;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show the picker with available connections.
   */
  showWithConnections(
    connections: ConnectionInfo[],
    currentConnectionId?: string | null
  ): Promise<ConnectionPickerResult> {
    this.currentConnectionId = currentConnectionId ?? null;

    // Add "New Connection" option at the end
    const items: (ConnectionInfo | 'new')[] = [...connections, 'new'];

    return this.showWithItems(
      {
        title: 'Select Connection',
        placeholder: 'Type to filter connections...',
        showSearchInput: true,
        maxResults: 15,
      },
      items,
      currentConnectionId ?? undefined
    ).then(result => {
      if (result.cancelled) return null;
      return result.value ?? null;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Abstract Implementation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Score a connection against the query.
   */
  protected override scoreItem(item: ConnectionInfo | 'new', query: string): number {
    if (item === 'new') {
      // Match "new" with relevant queries
      if ('new'.includes(query) || 'create'.includes(query) || 'add'.includes(query)) {
        return 10;
      }
      return 0;
    }

    // Score against connection name (primary)
    const nameScore = this.combinedScore(item.name, query);

    // Score against host (secondary)
    const hostScore = this.combinedScore(item.host, query) * 0.5;

    // Score against database (secondary)
    const dbScore = this.combinedScore(item.database, query) * 0.5;

    // Bonus for connected connections
    const connectedBonus = item.status === 'connected' ? 5 : 0;

    // Bonus for current connection
    const currentBonus = item.id === this.currentConnectionId ? 10 : 0;

    return Math.max(nameScore, hostScore, dbScore) + connectedBonus + currentBonus;
  }

  /**
   * Get display for a connection.
   */
  protected override getItemDisplay(
    item: ConnectionInfo | 'new',
    isSelected: boolean
  ): ItemDisplay {
    if (item === 'new') {
      return {
        text: 'New Connection...',
        secondary: 'Create a new database connection',
        icon: '+',
        isCurrent: false,
      };
    }

    // Status indicator
    let statusIcon = '○'; // disconnected
    if (item.status === 'connected') {
      statusIcon = '●'; // connected (green)
    } else if (item.status === 'connecting') {
      statusIcon = '◌'; // connecting
    } else if (item.status === 'error') {
      statusIcon = '✗'; // error
    }

    // Connection type badge
    const typeBadge = item.type === 'supabase' ? '[SB]' : '[PG]';

    return {
      text: `${statusIcon} ${item.name}`,
      secondary: `${typeBadge} ${item.host}/${item.database}`,
      icon: this.getConnectionIcon(item),
      isCurrent: item.id === this.currentConnectionId,
    };
  }

  /**
   * Get unique ID for a connection.
   */
  protected override getItemId(item: ConnectionInfo | 'new'): string {
    if (item === 'new') return '__new__';
    return item.id;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private getConnectionIcon(conn: ConnectionInfo): string {
    if (conn.status === 'connected') return '🟢';
    if (conn.status === 'error') return '🔴';
    if (conn.status === 'connecting') return '🟡';
    return '⚪';
  }
}

/**
 * Create a connection picker instance.
 */
export function createConnectionPicker(
  callbacks: OverlayManagerCallbacks
): ConnectionPickerDialog {
  return new ConnectionPickerDialog('connection-picker', callbacks);
}

export default ConnectionPickerDialog;
