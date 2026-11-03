import { createTaskHandler } from './tasks.js';

const handleTask = createTaskHandler();
self.onmessage = (event) => self.postMessage(handleTask(event.data));
