import { formatJson, parseJsonPreservingNumberLiterals } from '../core/json.js';
import { escapeJsonString, unescapeJsonString } from '../core/escape.js';
import { searchData } from '../core/search.js';
import { diffData } from '../core/structural-diff.js';
import { makeTextDiff } from '../core/text-diff.js';
import { parseErrorLocation } from '../core/parse-error.js';

/**
 * 一次 Worker 会话的任务入口。format/minify/parse 更新搜索数据；
 * clear 释放搜索数据，其他操作不改变它。includeData 只控制响应传输，不影响 Worker 内的缓存。
 * 输入 { id, action, text, ... }，返回带耗时的成功结果或含可用行列位置的错误。
 */
export function createTaskHandler() {
  let lastData;

  function runAction({ action, text, indent, ...options }) {
    switch (action) {
      case 'clear':
        lastData = undefined;
        return {};
      case 'format': {
        const includeData = options.includeData !== false;
        const formatted = formatJson(text, { indent, includeNumberLiterals: includeData });
        lastData = formatted.data;
        return includeData ? formatted : { text: formatted.text };
      }
      case 'minify': {
        const formatted = formatJson(text, { indent: null });
        lastData = formatted.data;
        return { text: formatted.text };
      }
      case 'parse': {
        const parsed = parseJsonPreservingNumberLiterals(text);
        lastData = parsed.data;
        return parsed;
      }
      case 'escape':
        return { text: escapeJsonString(text) };
      case 'unescape':
        return { text: unescapeJsonString(text) };
      case 'search':
        if (lastData === undefined) throw new Error('请先解析 JSON');
        return searchData(lastData, text);
      case 'diff': {
        let leftParsed;
        let rightParsed;
        try {
          leftParsed = parseJsonPreservingNumberLiterals(text);
        } catch (error) {
          throw new Error('左侧 JSON 无效：' + error.message);
        }
        if (options.text2 === text) {
          rightParsed = leftParsed;
        } else {
          try {
            rightParsed = parseJsonPreservingNumberLiterals(options.text2);
          } catch (error) {
            throw new Error('右侧 JSON 无效：' + error.message);
          }
        }
        return {
          ...diffData(leftParsed.data, rightParsed.data, {
            ...options,
            leftNumberLiterals: leftParsed.numberLiterals,
            rightNumberLiterals: rightParsed.numberLiterals,
          }),
          leftData: leftParsed.data,
          rightData: rightParsed.data,
          leftNumberLiterals: leftParsed.numberLiterals,
          rightNumberLiterals: rightParsed.numberLiterals,
        };
      }
      case 'textDiff':
        return makeTextDiff(text, options.text2, indent);
      default:
        throw new Error('未知操作: ' + action);
    }
  }

  return function handleTask(request) {
    const started = Date.now();
    try {
      const result = runAction(request);
      return { id: request.id, ok: true, result, duration: Date.now() - started };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: error.message,
        ...parseErrorLocation(error.message, request.text),
        duration: Date.now() - started,
      };
    }
  };
}
