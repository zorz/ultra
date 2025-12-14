// Go Test File
// Tests syntax highlighting for Go

package main

import (
	"fmt"
	"sync"
	"time"
)

// User represents a system user
type User struct {
	ID        int64
	Name      string
	Email     string
	CreatedAt time.Time
}

// UserStore manages user storage
type UserStore struct {
	mu    sync.RWMutex
	users map[int64]*User
}

// NewUserStore creates a new user store
func NewUserStore() *UserStore {
	return &UserStore{
		users: make(map[int64]*User),
	}
}

// Add adds a user to the store
func (s *UserStore) Add(user *User) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.users[user.ID]; exists {
		return fmt.Errorf("user %d already exists", user.ID)
	}

	s.users[user.ID] = user
	return nil
}

// Get retrieves a user by ID
func (s *UserStore) Get(id int64) (*User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	user, ok := s.users[id]
	return user, ok
}

func main() {
	store := NewUserStore()

	user := &User{
		ID:        1,
		Name:      "Alice",
		Email:     "alice@example.com",
		CreatedAt: time.Now(),
	}

	if err := store.Add(user); err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	if found, ok := store.Get(1); ok {
		fmt.Printf("Found user: %s <%s>\n", found.Name, found.Email)
	}

	// Goroutine example
	go func() {
		fmt.Println("Running in background")
	}()

	time.Sleep(100 * time.Millisecond)
}
