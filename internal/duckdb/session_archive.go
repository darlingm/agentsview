package duckdb

import (
	"context"

	"go.kenn.io/agentsview/internal/db"
)

// Archive markers are mirrored from SQLite; replica dashboards cannot mutate them.
func (s *Store) SetSessionsArchived(_ context.Context, _ []string, _ bool) ([]db.SessionArchiveState, error) {
	return nil, db.ErrReadOnly
}
