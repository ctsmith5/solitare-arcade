package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", defaultAddr(), "listen address")
	dsn := flag.String("db", databaseURL(), "Postgres connection URL")
	staticDir := flag.String("static", envOr("SOLITAIRE_STATIC", "static"), "directory of built frontend assets (optional)")
	flag.Parse()

	store, err := OpenStore(*dsn)
	if err != nil {
		if strings.TrimSpace(*dsn) == "" {
			// The commonest deploy mistake, so say exactly what to look at
			// rather than just repeating that the value is missing.
			log.Printf("checked these variables, all empty: %s", strings.Join(databaseURLVars, ", "))
			log.Printf("on Railway, set DATABASE_URL on THIS service to the reference")
			log.Printf(`  ${{Postgres.DATABASE_URL}}  — where "Postgres" is the exact name of your database service`)
			log.Printf("a reference naming a service that does not exist resolves to an empty string")
		}
		log.Fatalf("database: %v", err)
	}
	defer store.Close()

	api := &API{store: store}
	root := http.NewServeMux()
	root.Handle("/api/", api.Routes())

	if info, err := os.Stat(*staticDir); err == nil && info.IsDir() {
		log.Printf("serving frontend from %s", *staticDir)
		root.Handle("/", spaHandler(*staticDir))
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           root,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("🕹  solitaire arcade backend listening on %s", *addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("shutting down…")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

// spaHandler serves built assets and falls back to index.html so client-side
// routing keeps working on a hard refresh.
func spaHandler(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		if clean == "." || clean == string(filepath.Separator) {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		if _, err := os.Stat(filepath.Join(dir, clean)); errors.Is(err, os.ErrNotExist) {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		files.ServeHTTP(w, r)
	})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// databaseURLVars are the variable names checked for a connection string, in
// order. DATABASE_URL is the convention; the others are what managed Postgres
// add-ons sometimes publish instead, and accepting them turns a naming mismatch
// into a working deploy rather than a crash loop.
var databaseURLVars = []string{
	"DATABASE_URL",
	"DATABASE_PRIVATE_URL",
	"DATABASE_PUBLIC_URL",
	"POSTGRES_URL",
}

func databaseURL() string {
	for _, name := range databaseURLVars {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			return v
		}
	}
	return ""
}

// defaultAddr honours the PORT variable that most hosts (Railway, Render,
// Heroku, Fly) inject, falling back to the local development port.
//
// Binding to ":port" rather than "0.0.0.0:port" listens dual-stack, which
// Railway's IPv6-only private network requires.
func defaultAddr() string {
	if port := os.Getenv("PORT"); port != "" {
		return ":" + strings.TrimPrefix(port, ":")
	}
	return envOr("SOLITAIRE_ADDR", ":8080")
}
