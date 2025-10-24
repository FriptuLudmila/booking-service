export class TaskTimeoutError extends Error {
  constructor(message = 'Task execution timeout exceeded') {
    super(message);
    this.name = 'TaskTimeoutError';
    this.statusCode = 408;
  }
}

export class ConcurrentTaskLimitError extends Error {
  constructor(message = 'Concurrent task limit exceeded') {
    super(message);
    this.name = 'ConcurrentTaskLimitError';
    this.statusCode = 429;
  }
}

export class TaskManager {
  constructor(options = {}) {
    this.maxConcurrentTasks = options.maxConcurrentTasks || 10;
    this.taskTimeout = options.taskTimeout || 30000;
    this.activeTasks = 0;
    this.taskQueue = [];
  }

  async executeTask(taskFn, timeout = this.taskTimeout) {
    if (this.activeTasks >= this.maxConcurrentTasks) {
      throw new ConcurrentTaskLimitError(
        `Maximum concurrent tasks limit (${this.maxConcurrentTasks}) reached. Please try again later.`
      );
    }

    this.activeTasks++;

    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new TaskTimeoutError(
            `Task execution exceeded timeout of ${timeout}ms`
          ));
        }, timeout);
      });

      const result = await Promise.race([
        taskFn(),
        timeoutPromise
      ]);

      return result;
    } finally {
      this.activeTasks--;
    }
  }

  getStats() {
    return {
      activeTasks: this.activeTasks,
      maxConcurrentTasks: this.maxConcurrentTasks,
      taskTimeout: this.taskTimeout,
      availableSlots: this.maxConcurrentTasks - this.activeTasks
    };
  }

  updateConfig(options = {}) {
    if (options.maxConcurrentTasks !== undefined) {
      this.maxConcurrentTasks = options.maxConcurrentTasks;
    }
    if (options.taskTimeout !== undefined) {
      this.taskTimeout = options.taskTimeout;
    }
  }
}

export const taskManager = new TaskManager();
