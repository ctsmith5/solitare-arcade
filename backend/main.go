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
	addr := flag.String("addr", envOr("SOLITAIRE_ADDR", ":8080"), "listen address")
	dbPath := flag.String("db", envOr("SOLITAIRE_DB", "arcade.db"), "path to the SQLite database file")
	staticDir := flag.String("static", envOr("SOLITAIRE_STATIC", "static"), "directory of built frontend assets (optional)")
	flag.Parse()

	store, err := OpenStore(*dbPath)
	if err != nil {
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
		log.Printf("🕹  solitaire arcade backend listening on %s (db: %s)", *addr, *dbPath)
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
