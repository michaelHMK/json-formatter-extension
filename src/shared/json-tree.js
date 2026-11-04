export function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

// 只为命中路径建立祖先索引，宽容器无需为找到一个远端命中渲染全部兄弟。
export function createChildPathIndex(paths) {
  const index = new Map();
  for (let path of paths) {
    while (path !== '') {
      const parent = path.slice(0, path.lastIndexOf('/'));
      let children = index.get(parent);
      if (!children) index.set(parent, children = new Set());
      if (children.has(path)) break;
      children.add(path);
      path = parent;
    }
  }
  return index;
}
