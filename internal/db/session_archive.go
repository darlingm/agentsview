package db

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

// SessionArchiveState describes a changed user-owned archive marker. Archiving
// changes list presentation, never transcript retention, search, or reporting.
type SessionArchiveState struct {
	ID         string  `json:"id"`
	ArchivedAt *string `json:"archived_at"`
}

// SetSessionsArchived changes only non-trashed sessions whose marker differs
// from the requested state. Returning only changed rows makes batch undo safe
// when some selected sessions were already archived (or unarchived).
func (db *DB) SetSessionsArchived(ctx context.Context, ids []string, archived bool) ([]SessionArchiveState, error) {
	if err := db.requireWritable(); err != nil {
		return nil, err
	}
	changed := []SessionArchiveState{}
	if len(ids) == 0 {
		return changed, nil
	}
	db.mu.Lock()
	defer db.mu.Unlock()
	tx, err := db.getWriter().Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin archive state transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	value, condition := "NULL", "IS NOT NULL"
	if archived {
		value, condition = "strftime('%Y-%m-%dT%H:%M:%fZ','now')", "IS NULL"
	}
	const batchSize = 500
	for i := 0; i < len(ids); i += batchSize {
		batch := ids[i:min(i+batchSize, len(ids))]
		args := make([]any, len(batch))
		for j, id := range batch {
			args[j] = id
		}
		rows, err := tx.QueryContext(ctx, `UPDATE sessions SET archived_at = `+value+`,
			local_modified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			WHERE id IN (`+strings.Repeat(",?", len(batch))[1:]+`)
				AND deleted_at IS NULL AND archived_at `+condition+`
			RETURNING id, archived_at`, args...)
		if err != nil {
			return nil, fmt.Errorf("updating archive state: %w", err)
		}
		for rows.Next() {
			var state SessionArchiveState
			if err := rows.Scan(&state.ID, &state.ArchivedAt); err != nil {
				_ = rows.Close()
				return nil, fmt.Errorf("reading archive state: %w", err)
			}
			changed = append(changed, state)
		}
		rowsErr := rows.Err()
		closeErr := rows.Close()
		if rowsErr != nil {
			return nil, fmt.Errorf("iterating archive states: %w", rowsErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("closing archive states: %w", closeErr)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("committing archive state: %w", err)
	}
	slices.SortFunc(changed, func(a, b SessionArchiveState) int { return strings.Compare(a.ID, b.ID) })
	return changed, nil
}

// ArchiveStatePredicate is empty by default, so adding archive metadata cannot
// silently exclude history from shared query builders used by reports/search.
func ArchiveStatePredicate(state, alias string) string {
	column := "archived_at"
	if alias != "" {
		column = alias + "." + column
	}
	switch state {
	case "archived":
		return column + " IS NOT NULL"
	case "unarchived":
		return column + " IS NULL"
	default:
		return ""
	}
}

// BuildSidebarRootWhere promotes a matching child when its parent is filtered
// out by archive state. A mixed archive tree must not strand a child or force
// an unmatching parent into the archived-only list.
func BuildSidebarRootWhere(f SessionFilter, dialect QueryDialect, alias string) string {
	base := BuildCanonicalRootWhere(dialect, alias, f.IncludeOrphans)
	pred := ArchiveStatePredicate(f.ArchiveState, "archive_parent")
	if !f.IncludeOrphans || pred == "" {
		return base
	}
	return "(" + base + " OR (" + CanonicalChildRelationshipPredicate(dialect, alias) + ` AND NOT EXISTS (
		SELECT 1 FROM sessions archive_parent WHERE ` + dialect.ParentRelation(alias, "archive_parent") + `
			AND archive_parent.deleted_at IS NULL AND ` + pred + ")))"
}
