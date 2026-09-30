package server

import (
	"context"
	"net/http"

	"go.kenn.io/agentsview/internal/db"
)

// Huma discovers exported embedded fields. Keep the standard list parameters
// shared without duplicating them in the archive-aware sidebar input.
type SessionListFilterParams = sessionFilterInput

type sidebarSessionFilterInput struct {
	SessionListFilterParams
	ArchiveState string `query:"archive_state" enum:"all,unarchived,archived" doc:"List-only archive filter; omitted includes archived sessions"`
}

type batchArchiveInput struct {
	Body struct {
		SessionIDs []string `json:"session_ids" required:"true" minItems:"1" maxItems:"1000" doc:"Session IDs whose archive markers should change"`
		Archived   bool     `json:"archived" required:"true" doc:"True to archive; false to unarchive"`
	}
}

type archiveStateResponse struct {
	Sessions []db.SessionArchiveState `json:"sessions" doc:"Only sessions whose archive state changed"`
}

func (s *Server) humaArchiveSession(ctx context.Context, in *idPathInput) (*jsonOutput[archiveStateResponse], error) {
	return s.setSessionArchived(ctx, in.ID, true)
}
func (s *Server) humaUnarchiveSession(ctx context.Context, in *idPathInput) (*jsonOutput[archiveStateResponse], error) {
	return s.setSessionArchived(ctx, in.ID, false)
}
func (s *Server) setSessionArchived(ctx context.Context, id string, archived bool) (*jsonOutput[archiveStateResponse], error) {
	changed, err := s.db.SetSessionsArchived(ctx, []string{id}, archived)
	if err != nil {
		if handled := handleHumaReadOnly(err); handled != nil {
			return nil, handled
		}
		return nil, internalError("set archive state", err)
	}
	if len(changed) == 0 {
		session, err := s.db.GetSession(ctx, id)
		if err != nil {
			return nil, internalError("get session", err)
		}
		if session == nil {
			return nil, apiError(http.StatusNotFound, "session not found")
		}
	} else {
		s.notifySessionMutation()
	}
	return &jsonOutput[archiveStateResponse]{Body: archiveStateResponse{Sessions: changed}}, nil
}
func (s *Server) humaBatchArchiveSessions(ctx context.Context, in *batchArchiveInput) (*jsonOutput[archiveStateResponse], error) {
	changed, err := s.db.SetSessionsArchived(ctx, in.Body.SessionIDs, in.Body.Archived)
	if err != nil {
		if handled := handleHumaReadOnly(err); handled != nil {
			return nil, handled
		}
		return nil, internalError("set batch archive state", err)
	}
	if len(changed) > 0 {
		s.notifySessionMutation()
	}
	return &jsonOutput[archiveStateResponse]{Body: archiveStateResponse{Sessions: changed}}, nil
}
