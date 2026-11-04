// V8's structured clone has a shallower stack limit than JSON.parse. Ordinary
// objects use native cloning; only a failed tree transfer falls back to source
// text from the exact Worker snapshot. The usual path never parses on the UI.
export function postTaskResponse(request, handleTask, postMessage) {
  const response = handleTask(request);
  try {
    postMessage(response);
  } catch (error) {
    const result = response.result;
    const snapshotId = result?.snapshotId ?? request.snapshotId;
    const kind = result && Object.hasOwn(result, 'data') ? 'document'
      : result && Object.hasOwn(result, 'leftData') ? 'comparison' : null;
    const snapshot = response.ok && kind && snapshotId !== undefined
      ? handleTask({ action: 'snapshotText', snapshotId, kind }) : null;
    if (snapshot?.ok) {
      const { data, leftData, rightData, ...metadata } = result;
      try {
        postMessage({ ...response, result: { ...metadata, serializedData: snapshot.result } });
        return;
      } catch (fallbackError) {
        error = fallbackError;
      }
    }
    // A response-transfer error must settle the request, not kill the Worker
    // and leave this and all later operations unusable.
    postMessage({ id: request.id, ok: false, error: error.message || String(error), duration: response.duration });
  }
}

export function decodeTaskResponse(response) {
  const serialized = response.result?.serializedData;
  if (!response.ok || !serialized) return response;
  const { serializedData, ...result } = response.result;
  try {
    if (Object.hasOwn(serialized, 'data')) result.data = JSON.parse(serialized.data);
    else {
      result.leftData = JSON.parse(serialized.leftData);
      result.rightData = serialized.leftData === serialized.rightData
        ? result.leftData : JSON.parse(serialized.rightData);
    }
    return { ...response, result };
  } catch (error) {
    return { id: response.id, ok: false, error: error.message || String(error), duration: response.duration };
  }
}
