//go:build !(windows && arm64)

package duckdb

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.kenn.io/agentsview/internal/db"
	"go.kenn.io/agentsview/internal/storage"
)

func TestArchiveStateSurvivesIncrementalMirrorPush(t *testing.T) {
	ctx := t.Context()
	local, path := newPushFixture(t, 2)
	_, err := Push(ctx, path, local, "m", storage.MirrorPushOptions{}, false, nil)
	require.NoError(t, err)
	for _, archived := range []bool{true, false} {
		changed, err := local.SetSessionsArchived(ctx, []string{"sess-1"}, archived)
		require.NoError(t, err)
		require.Len(t, changed, 1)
		result, err := Push(ctx, path, local, "m", storage.MirrorPushOptions{}, false, nil)
		require.NoError(t, err)
		assert.Equal(t, 1, result.Diagnostics.PushedSessions.Total)

		store, err := NewStore(ctx, path)
		require.NoError(t, err)
		t.Cleanup(func() { _ = store.Close() })
		session, err := store.GetSession(ctx, "sess-1")
		require.NoError(t, err)
		require.NotNil(t, session)
		assert.Equal(t, archived, session.ArchivedAt != nil)
		states := []string{"all", "unarchived", "archived"}
		for _, state := range states {
			index, err := store.GetSidebarSessionIndex(ctx, db.SessionFilter{
				ArchiveState:    state,
				IncludeChildren: true, IncludeOrphans: true,
			})
			require.NoError(t, err)
			want := 2
			if state == "archived" {
				want = 0
				if archived {
					want = 1
				}
			}
			if state == "unarchived" && archived {
				want = 1
			}
			assert.Len(t, index.Sessions, want, state)
		}
		stats, err := store.GetStats(ctx, false, false)
		require.NoError(t, err)
		assert.Equal(t, 2, stats.SessionCount)
		_, err = store.SetSessionsArchived(ctx, []string{"sess-1"}, !archived)
		assert.ErrorIs(t, err, db.ErrReadOnly)
		require.NoError(t, store.Close())
	}
}
