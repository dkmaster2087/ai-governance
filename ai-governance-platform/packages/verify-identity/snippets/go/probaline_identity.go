// Package probaline checks the X-Probaline-Identity header on a Go API (net/http middleware).
//
// Only calls that came through Probaline carry a valid one: a five-minute ES256 token naming who asked.
// Not yet tested in Probaline's CI; the Node and Python versions are.
//
//	go get github.com/golang-jwt/jwt/v5 github.com/MicahParks/keyfunc/v3
//
//	guard, err := probaline.NewGuard("https://gateway.acme.example", "https://hr.acme.example/api", false)
//	http.Handle("/", guard.Middleware(yourHandler))
//	// in a handler: who := probaline.FromContext(r.Context())
package probaline

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

const (
	Header    = "X-Probaline-Identity"
	TokenType = "probaline-identity+jwt"
)

type Identity struct {
	jwt.RegisteredClaims
	Kind   string   `json:"kind"`
	Email  string   `json:"email,omitempty"`
	Name   string   `json:"name,omitempty"`
	Groups []string `json:"groups,omitempty"`
	Tenant string   `json:"tenant"`
	Server string   `json:"server"`
	Tool   string   `json:"tool"`
	Agent  string   `json:"agent,omitempty"`
	RID    string   `json:"rid"`
}

type Guard struct {
	issuer, audience string
	reportOnly       bool
	keys             keyfunc.Keyfunc
}

// NewGuard fetches Probaline's keys from <issuer>/.well-known/jwks.json and refreshes them in the background.
func NewGuard(issuer, audience string, reportOnly bool) (*Guard, error) {
	issuer, audience = strings.TrimRight(issuer, "/"), strings.TrimRight(audience, "/")
	k, err := keyfunc.NewDefault([]string{issuer + "/.well-known/jwks.json"})
	if err != nil {
		return nil, err
	}
	return &Guard{issuer: issuer, audience: audience, reportOnly: reportOnly, keys: k}, nil
}

// Verify returns who asked, or an error saying why the call didn't come through Probaline.
func (g *Guard) Verify(token string) (*Identity, error) {
	if token == "" {
		return nil, errors.New("missing: no X-Probaline-Identity header")
	}
	id := &Identity{}
	parsed, err := jwt.ParseWithClaims(token, id, func(t *jwt.Token) (any, error) {
		// Only ES256: never "none", never a shared secret.
		if t.Method.Alg() != "ES256" || t.Header["typ"] != TokenType {
			return nil, errors.New("wrong_type: not a Probaline identity token")
		}
		return g.keys.Keyfunc(t)
	}, jwt.WithValidMethods([]string{"ES256"}), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(30*time.Second))
	if err != nil || !parsed.Valid {
		return nil, err
	}
	if strings.TrimRight(id.Issuer, "/") != g.issuer {
		return nil, errors.New("wrong_issuer: from a different Probaline gateway")
	}
	auds := make([]string, 0, len(id.Audience))
	for _, a := range id.Audience {
		auds = append(auds, strings.TrimRight(a, "/"))
	}
	if !slices.Contains(auds, g.audience) {
		return nil, errors.New("wrong_audience: the token is for a different API")
	}
	return id, nil
}

type ctxKey struct{}

// FromContext is the identity the middleware checked, or nil in report-only mode.
func FromContext(ctx context.Context) *Identity {
	id, _ := ctx.Value(ctxKey{}).(*Identity)
	return id
}

// Middleware refuses calls without a valid identity with 401 (or logs them in report-only mode).
func (g *Guard) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := g.Verify(r.Header.Get(Header))
		if err != nil {
			log.Printf("call without a valid Probaline identity: %v %s %s", err, r.Method, r.URL.Path)
			if !g.reportOnly {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("WWW-Authenticate", "Probaline-Identity")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	})
}
