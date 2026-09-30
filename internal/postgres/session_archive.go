package postgres

import (
	"context"

	"go.kenn.io/agentsview/internal/db"
)

// Archive markers are mirrored from SQLite; replica dashboards cannot mutate them.
func (s *Store) SetSessionsArchived(_ context.Context, _ []string, _ bool) ([]db.SessionArchiveState, error) {
	return nil, db.ErrReadOnly
}

// Hosted curation does not yet define a public archive-marker mapping. Fail
// explicitly rather than accepting physical session IDs across that boundary.
func (h *HostedStore) SetSessionsArchived(_ context.Context, _ []string, _ bool) ([]db.SessionArchiveState, error) {
	return nil, db.ErrReadOnly
}
