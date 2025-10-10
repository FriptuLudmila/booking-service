// taskManager.js
/**
 * Task Manager for handling request timeouts and concurrent task limits
 */

export class TaskTimeoutError extends Error {
  constructor(message = 'Task execution timeout exceeded') {
    super(message);
    this.name = 'TaskTimeoutError';
    this.statusCode = 408; // Request Timeout
  }
}

export class ConcurrentTaskLimitError extends Error {
  constructor(message = 'Concurrent task limit exceeded') {
    super(message);
    this.name = 'ConcurrentTaskLimitError';
    this.statusCode = 429; // Too Many Requests
  }
}

export class TaskManager {
  constructor(options = {}) {
    this.maxConcurrentTasks = options.maxConcurrentTasks || 10;
    this.taskTimeout = options.taskTimeout || 30000; // 30 seconds default
    this.activeTasks = 0;
    this.taskQueue = [];
  }

  /**
   * Execute a task with timeout and concurrency control
   * @param {Function} taskFn - The async function to execute
   * @param {number} timeout - Optional custom timeout (ms)
   * @returns {Promise} - The result of the task
   * @throws {TaskTimeoutError} - If task execution exceeds timeout
   * @throws {ConcurrentTaskLimitError} - If concurrent task limit is reached
   */
  async executeTask(taskFn, timeout = this.taskTimeout) {
    // Check concurrent task limit
    if (this.activeTasks >= this.maxConcurrentTasks) {
      throw new ConcurrentTaskLimitError(
        `Maximum concurrent tasks limit (${this.maxConcurrentTasks}) reached. Please try again later.`
      );
    }

    this.activeTasks++;

    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new TaskTimeoutError(
            `Task execution exceeded timeout of ${timeout}ms`
          ));
        }, timeout);
      });

      // Race between task execution and timeout
      const result = await Promise.race([
        taskFn(),
        timeoutPromise
      ]);

      return result;
    } finally {
      // Always decrement active tasks, even on error
      this.activeTasks--;
    }
  }

  /**
   * Get current task statistics
   * @returns {Object} - Current task manager state
   */
  getStats() {
    return {
      activeTasks: this.activeTasks,
      maxConcurrentTasks: this.maxConcurrentTasks,
      taskTimeout: this.taskTimeout,
      availableSlots: this.maxConcurrentTasks - this.activeTasks
    };
  }

  /**
   * Update configuration
   * @param {Object} options - New configuration options
   */
  updateConfig(options = {}) {
    if (options.maxConcurrentTasks !== undefined) {
      this.maxConcurrentTasks = options.maxConcurrentTasks;
    }
    if (options.taskTimeout !== undefined) {
      this.taskTimeout = options.taskTimeout;
    }
  }
}

// Create and export singleton instance
export const taskManager = new TaskManager();
