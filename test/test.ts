/**
 * TypeScript Test File
 * Tests syntax highlighting for TypeScript
 */

interface User {
  id: number;
  name: string;
  email?: string;
}

type Status = 'active' | 'inactive' | 'pending';

class UserService {
  private users: Map<number, User> = new Map();

  constructor(private readonly apiUrl: string) {}

  async fetchUser(id: number): Promise<User | null> {
    const response = await fetch(`${this.apiUrl}/users/${id}`);
    if (!response.ok) {
      return null;
    }
    return response.json() as Promise<User>;
  }

  addUser(user: User): void {
    this.users.set(user.id, user);
  }

  getStatus(user: User): Status {
    return user.email ? 'active' : 'pending';
  }
}

// Generic function
function identity<T>(value: T): T {
  return value;
}

// Arrow function with destructuring
const greet = ({ name, email }: User): string => {
  return `Hello, ${name}! Your email is ${email ?? 'not set'}`;
};

// Constants and literals
const MAX_USERS = 100;
const PI = 3.14159;
const isEnabled = true;
const nothing = null;

export { UserService, greet, identity };
