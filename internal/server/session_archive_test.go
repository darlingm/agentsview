package server_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSessionArchiveRoutes(t *testing.T) {
	te := setup(t)
	te.seedSession(t, "session-a", "archive-test", 2)
	te.seedSession(t, "session-b", "archive-test", 2)
	w := te.put(t, "/api/v1/sessions/session-a/archive", `{}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), `"id":"session-a"`)
	assert.Contains(t, w.Body.String(), `"archived_at":"`)
	w = te.put(t, "/api/v1/sessions/session-a/archive", `{}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), `"sessions":[]`)
	w = te.get(t, "/api/v1/sessions/sidebar-index?archive_state=unarchived&project=archive-test&limit=1")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.NotContains(t, w.Body.String(), `"id":"session-a"`)
	assert.Contains(t, w.Body.String(), `"id":"session-b"`)
	w = te.get(t, "/api/v1/sessions/sidebar-index?archive_state=archived&project=archive-test&limit=1")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), `"id":"session-a"`)
	assert.NotContains(t, w.Body.String(), `"id":"session-b"`)
	w = te.get(t, "/api/v1/sessions?project=archive-test")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), `"id":"session-a"`)
	assert.Contains(t, w.Body.String(), `"id":"session-b"`)
	w = te.get(t, "/api/v1/sessions/session-a")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), `"archived_at":"`)
	w = te.get(t, "/api/v1/trash")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.NotContains(t, w.Body.String(), `"id":"session-a"`)
	w = te.del(t, "/api/v1/sessions/session-a/archive")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), `"archived_at":null`)
	w = te.post(t, "/api/v1/sessions/batch-archive", `{"session_ids":["session-a","session-b"],"archived":true}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), `"id":"session-a"`)
	assert.Contains(t, w.Body.String(), `"id":"session-b"`)
	w = te.post(t, "/api/v1/sessions/batch-archive", `{"session_ids":["session-a","session-b"],"archived":false}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), `"archived_at":null`)
}

func TestSessionArchiveRejectsMissingTrashedAndInvalidInputs(t *testing.T) {
	te := setup(t)
	te.seedSession(t, "trashed", "archive-test", 2)
	require.NoError(t, te.db.SoftDeleteSession(t.Context(), "trashed"))
	for _, id := range []string{"missing", "trashed"} {
		w := te.put(t, "/api/v1/sessions/"+id+"/archive", `{}`)
		assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
	}
	w := te.get(t, "/api/v1/sessions/sidebar-index?archive_state=invalid")
	assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	for _, body := range []string{`{"session_ids":[],"archived":true}`, `{"session_ids":["missing"]}`, `{"session_ids":["missing"],"archived":"yes"}`} {
		w := te.post(t, "/api/v1/sessions/batch-archive", body)
		assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	}
}

func TestSessionArchiveReturns503WhileWriterClosed(t *testing.T) {
	te := setup(t)
	te.seedSession(t, "session-a", "archive-test", 2)
	require.NoError(t, te.db.CloseWriter())
	defer func() { assert.NoError(t, te.db.ReopenWriter()) }()
	w := te.put(t, "/api/v1/sessions/session-a/archive", `{}`)
	assert.Equal(t, http.StatusServiceUnavailable, w.Code, w.Body.String())
	assert.Equal(t, "5", w.Header().Get("Retry-After"))
}
