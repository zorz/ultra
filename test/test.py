"""
Python Test File
Tests syntax highlighting for Python
"""

from dataclasses import dataclass
from typing import Optional, List
import asyncio


@dataclass
class Task:
    id: int
    title: str
    completed: bool = False
    assignee: Optional[str] = None


class TaskManager:
    """Manages a collection of tasks."""

    def __init__(self):
        self._tasks: List[Task] = []
        self._next_id = 1

    def add_task(self, title: str, assignee: str = None) -> Task:
        task = Task(
            id=self._next_id,
            title=title,
            assignee=assignee
        )
        self._tasks.append(task)
        self._next_id += 1
        return task

    def complete_task(self, task_id: int) -> bool:
        for task in self._tasks:
            if task.id == task_id:
                task.completed = True
                return True
        return False

    @property
    def pending_tasks(self) -> List[Task]:
        return [t for t in self._tasks if not t.completed]


async def fetch_data(url: str) -> dict:
    """Simulate async data fetching."""
    await asyncio.sleep(0.1)
    return {"url": url, "status": "success"}


# Dictionary and f-strings
config = {
    "debug": True,
    "max_connections": 100,
    "timeout": 30.5,
}

message = f"Config has {len(config)} settings"

# Lambda and comprehensions
square = lambda x: x ** 2
squares = [square(n) for n in range(10)]
even_squares = {n: n**2 for n in range(10) if n % 2 == 0}

if __name__ == "__main__":
    manager = TaskManager()
    manager.add_task("Write tests", "Alice")
    print(f"Pending: {len(manager.pending_tasks)}")
