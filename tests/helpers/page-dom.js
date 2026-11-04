import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { appendJsonPath, PATH_SEP } from '../../src/core/json-path.js';

// Minimal DOM for exercising real page handlers and lazy rendering in Node.
// Browser layout/paint still needs browser verification.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.events = {};
    this.className = '';
    this.value = '';
    this.textContent = '';
    this.classList = {
      add: (name) => { if (!this.classList.contains(name)) this.className += ' ' + name; },
      remove: (name) => { this.className = this.className.split(' ').filter((part) => part !== name).join(' '); },
      contains: (name) => this.className.split(' ').includes(name),
      toggle: (name, enabled) => { this.classList[enabled ? 'add' : 'remove'](name); },
    };
  }
  appendChild(child) {
    if (child.tagName === '#fragment') {
      for (const item of child.children) this.appendChild(item);
    } else {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }
  set innerHTML(value) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
  before(node) {
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    const nodes = node.tagName === '#fragment' ? node.children : [node];
    for (const child of nodes) child.parentElement = parent;
    parent.children.splice(index, 0, ...nodes);
  }
  addEventListener(type, listener) { this.events[type] = listener; }
  click() { return this.events.click?.({ target: this }); }
  focus() {}
  scrollIntoView() {}
  remove() {
    const parent = this.parentElement;
    if (parent) parent.children = parent.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  querySelectorAll(selector) {
    const classes = selector.split('.').filter(Boolean);
    const found = [];
    for (const child of this.children) {
      if (classes.every((name) => child.classList.contains(name))) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

export function loadPage(name, {
  runTask = async () => ({ ok: true, result: {} }),
  expose,
  bodyDataset = {},
}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const context = vm.createContext({
    document: {
      body: { dataset: bodyDataset },
      getElementById: get,
      createElement: (tag) => new Element(tag),
      createDocumentFragment: () => new Element('#fragment'),
    },
    initializePage: () => {},
    createTaskRunner: () => runTask,
    createFeedback: () => ({
      setStatus(text) { get('status').textContent = text; },
      showError(text) { get('error').textContent = text; get('error').hidden = false; },
      hideError() { get('error').textContent = ''; get('error').hidden = true; },
      showParseError(text, response) { get('error').textContent = response.error; get('error').hidden = false; },
    }),
    t: (key) => key,
    appendJsonPath,
    PATH_SEP,
    copyText: async () => {},
    setTimeout,
    clearTimeout,
  });
  const treeSource = readFileSync(new URL('../../src/shared/json-tree.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(treeSource, context);
  const source = readFileSync(new URL(`../../src/pages/${name}.js`, import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '');
  vm.runInContext(source + `\nglobalThis.page = ${expose};`, context);
  return { ...context.page, get };
}
