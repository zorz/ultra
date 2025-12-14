/**
 * JavaScript Test File
 * Tests syntax highlighting for JavaScript
 */

class EventEmitter {
  constructor() {
    this.events = new Map();
  }

  on(event, listener) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push(listener);
    return this;
  }

  emit(event, ...args) {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach(fn => fn(...args));
    }
    return this;
  }
}

// Async/await example
async function loadData(url) {
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to load:', error.message);
    throw error;
  }
}

// Array methods
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
const evens = numbers.filter(n => n % 2 === 0);
const sum = numbers.reduce((acc, n) => acc + n, 0);

// Object destructuring and spread
const config = { host: 'localhost', port: 3000 };
const { host, port } = config;
const extended = { ...config, secure: true };

// Regular expressions
const emailRegex = /^[\w.-]+@[\w.-]+\.\w+$/;
const isValid = emailRegex.test('user@example.com');

module.exports = { EventEmitter, loadData };
