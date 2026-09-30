//go:build fts5

package db

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedArchiveSession(t *testing.T, database *DB, id, parent string) Session {
	t.Helper()
	title := "archive evidence " + id
	start := "2026-09-01T10:00:00.000Z"
	end := "2026-09-01T10:01:00.000Z"
	session := Session{ID: id, Project: "archive-test", Machine: "local", Agent: "claude",
		FirstMessage: &title, SessionName: &title, StartedAt: &start, EndedAt: &end,
		CreatedAt: start, MessageCount: 3, UserMessageCount: 2,
	}
	if parent != "" {
		session.ParentSessionID = &parent
		session.RelationshipType = "subagent"
	}
	require.NoError(t, database.UpsertSession(t.Context(), session))
	require.NoError(t, database.InsertMessages(t.Context(), []Message{
		{SessionID: id, Ordinal: 0, Role: "user", Content: title, Timestamp: start},
		{SessionID: id, Ordinal: 1, Role: "assistant", Content: "completed answer", Timestamp: end, Model: "claude-sonnet-4-5", TokenUsage: []byte(`{"input_tokens":10,"output_tokens":5}`)},
		{SessionID: id, Ordinal: 2, Role: "user", Content: "thank you", Timestamp: end},
	}))
	return session
}

func TestSessionArchivePreservesHistoryAndSourceUpdates(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	original := seedArchiveSession(t, database, "session-a", "")
	seedArchiveSession(t, database, "session-b", "")
	statsBefore, err := database.GetStats(ctx, false, false)
	require.NoError(t, err)
	analyticsBefore, err := database.GetAnalyticsSummary(ctx, AnalyticsFilter{})
	require.NoError(t, err)
	usageBefore, err := database.GetDailyUsage(ctx, UsageFilter{From: "2026-09-01", To: "2026-09-30", Timezone: "UTC"})
	require.NoError(t, err)
	searchBefore, err := database.Search(ctx, SearchFilter{Query: "archive"})
	require.NoError(t, err)
	require.Len(t, searchBefore.Results, 2)
	fullBefore, err := database.GetSessionFull(ctx, original.ID)
	require.NoError(t, err)
	changed, err := database.SetSessionsArchived(ctx, []string{original.ID}, true)
	require.NoError(t, err)
	require.Len(t, changed, 1)
	require.NotNil(t, changed[0].ArchivedAt)
	archived, err := database.GetSession(ctx, original.ID)
	require.NoError(t, err)
	require.NotNil(t, archived)
	assert.Equal(t, changed[0].ArchivedAt, archived.ArchivedAt)
	assert.Nil(t, archived.DeletedAt)
	assert.Equal(t, fullBefore.TranscriptRevision, archived.TranscriptRevision)
	assert.Equal(t, fullBefore.CreatedAt, archived.CreatedAt)
	assert.Equal(t, original.EndedAt, archived.EndedAt)
	changed, err = database.SetSessionsArchived(ctx, []string{original.ID}, true)
	require.NoError(t, err)
	assert.Empty(t, changed)
	statsAfter, err := database.GetStats(ctx, false, false)
	require.NoError(t, err)
	assert.Equal(t, statsBefore, statsAfter)
	analyticsAfter, err := database.GetAnalyticsSummary(ctx, AnalyticsFilter{})
	require.NoError(t, err)
	assert.Equal(t, analyticsBefore, analyticsAfter)
	usageAfter, err := database.GetDailyUsage(ctx, UsageFilter{From: "2026-09-01", To: "2026-09-30", Timezone: "UTC"})
	require.NoError(t, err)
	assert.Equal(t, usageBefore, usageAfter)
	searchAfter, err := database.Search(ctx, SearchFilter{Query: "archive"})
	require.NoError(t, err)
	assert.Equal(t, searchBefore, searchAfter)
	// Parser-owned fields may refresh, but the archive marker is user-owned.
	original.GitBranch = "updated-branch"
	require.NoError(t, database.UpsertSession(ctx, original))
	refreshed, err := database.GetSessionFull(ctx, original.ID)
	require.NoError(t, err)
	assert.Equal(t, archived.ArchivedAt, refreshed.ArchivedAt)
	assert.Equal(t, "updated-branch", refreshed.GitBranch)
	require.NoError(t, database.SoftDeleteSession(ctx, original.ID))
	_, err = database.SetSessionsArchived(ctx, []string{original.ID}, false)
	require.NoError(t, err)
	trashed, err := database.GetSessionFull(ctx, original.ID)
	require.NoError(t, err)
	assert.Equal(t, archived.ArchivedAt, trashed.ArchivedAt)
	assert.NotNil(t, trashed.DeletedAt)
	_, err = database.RestoreSession(ctx, original.ID)
	require.NoError(t, err)
	changed, err = database.SetSessionsArchived(ctx, []string{original.ID}, false)
	require.NoError(t, err)
	require.Len(t, changed, 1)
	assert.Nil(t, changed[0].ArchivedAt)
	changed, err = database.SetSessionsArchived(ctx, []string{original.ID}, false)
	require.NoError(t, err)
	assert.Empty(t, changed)
	readOnly, err := OpenReadOnly(ctx, database.Path())
	require.NoError(t, err)
	defer func() { assert.NoError(t, readOnly.Close()) }()
	_, err = readOnly.SetSessionsArchived(ctx, []string{original.ID}, true)
	assert.ErrorIs(t, err, ErrReadOnly)
}

func TestSessionArchiveMixedTreePagination(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	for _, row := range []struct{ id, parent string }{
		{"root-a", ""}, {"child-a", "root-a"}, {"grand-a", "child-a"},
		{"root-b", ""}, {"child-b", "root-b"}, {"root-c", ""},
	} {
		seedArchiveSession(t, database, row.id, row.parent)
	}
	_, err := database.SetSessionsArchived(ctx, []string{"child-a", "root-b"}, true)
	require.NoError(t, err)
	for _, tt := range []struct {
		state string
		ids   []string
		roots int
	}{
		{"all", []string{"root-a", "child-a", "grand-a", "root-b", "child-b", "root-c"}, 3},
		{"unarchived", []string{"root-a", "grand-a", "child-b", "root-c"}, 4},
		{"archived", []string{"child-a", "root-b"}, 2},
	} {
		for _, limit := range []int{0, 1} {
			t.Run(fmt.Sprintf("%s/limit-%d", tt.state, limit), func(t *testing.T) {
				filter := SessionFilter{ArchiveState: tt.state, Limit: limit}
				var ids []string
				for page := 0; page < 10; page++ {
					index, err := database.GetSidebarSessionIndex(ctx, filter)
					require.NoError(t, err)
					assert.Equal(t, tt.roots, index.Total)
					for _, session := range index.Sessions {
						ids = append(ids, session.ID)
						if tt.state == "archived" {
							assert.NotNil(t, session.ArchivedAt)
						} else if tt.state == "unarchived" {
							assert.Nil(t, session.ArchivedAt)
						}
					}
					if index.NextCursor == "" {
						break
					}
					filter.Cursor = index.NextCursor
				}
				assert.ElementsMatch(t, tt.ids, ids)
			})
		}
	}
	// Ordinary list/export callers have no new implicit exclusion.
	page, err := database.ListSessions(ctx, SessionFilter{IncludeChildren: true})
	require.NoError(t, err)
	assert.Len(t, page.Sessions, 6)
}

func TestSessionArchiveBatchReturnsOnlyChangedRows(t *testing.T) {
	database := testDB(t)
	ctx := t.Context()
	ids := make([]string, 502)
	for i := range ids {
		ids[i] = fmt.Sprintf("session-%03d", i)
		require.NoError(t, database.UpsertSession(ctx, Session{ID: ids[i], Agent: "claude", Project: "archive-test", Machine: "local"}))
	}
	_, err := database.SetSessionsArchived(ctx, ids[:1], true)
	require.NoError(t, err)
	require.NoError(t, database.SoftDeleteSession(ctx, ids[1]))
	changed, err := database.SetSessionsArchived(ctx, append(ids, ids[0], "missing"), true)
	require.NoError(t, err)
	assert.Len(t, changed, 500)
	for _, row := range changed {
		assert.NotNil(t, row.ArchivedAt)
		assert.NotEqual(t, ids[0], row.ID)
		assert.NotEqual(t, ids[1], row.ID)
	}
	changed, err = database.SetSessionsArchived(ctx, ids, true)
	require.NoError(t, err)
	assert.Empty(t, changed)
}

func TestSessionArchiveSurvivesRebuildCopies(t *testing.T) {
	source := testDB(t)
	replacement := testDB(t)
	ctx := t.Context()
	for _, id := range []string{"reparsed", "orphan", "trash"} {
		seedArchiveSession(t, source, id, "")
	}
	_, err := source.SetSessionsArchived(ctx, []string{"reparsed", "orphan", "trash"}, true)
	require.NoError(t, err)
	require.NoError(t, source.SoftDeleteSession(ctx, "trash"))
	seedArchiveSession(t, replacement, "reparsed", "")
	_, err = replacement.CopyTrashedDataFrom(source.Path())
	require.NoError(t, err)
	_, err = replacement.CopyOrphanedDataFrom(source.Path())
	require.NoError(t, err)
	require.NoError(t, replacement.CopySessionMetadataFrom(source.Path()))
	for _, id := range []string{"reparsed", "orphan", "trash"} {
		old, err := source.GetSessionFull(ctx, id)
		require.NoError(t, err)
		fresh, err := replacement.GetSessionFull(ctx, id)
		require.NoError(t, err)
		require.NotNil(t, fresh)
		assert.Equal(t, old.ArchivedAt, fresh.ArchivedAt)
		assert.Equal(t, old.DeletedAt, fresh.DeletedAt)
	}
}
