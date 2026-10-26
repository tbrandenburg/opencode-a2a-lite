# Read every JSONL event, not just the final status. Fail closed on unknown shapes.
.[0].task as $task |
[.[] | .artifactUpdate? // empty] as $chunks |
[.[] | .statusUpdate? // empty] as $statuses |
if (
  ($task.id | type == "string" and length > 0) and
  ($task.contextId | type == "string" and length > 0) and
  $task.status.state == "TASK_STATE_SUBMITTED" and
  ([.[] | select(has("task"))] | length) == 1 and
  (.[1].statusUpdate.status.state == "TASK_STATE_WORKING") and
  (all(.[]; (keys | length) == 1 and (has("task") or has("statusUpdate") or has("artifactUpdate")))) and
  (all(.[]; (.task // .statusUpdate // .artifactUpdate) |
    (.id // .taskId) == $task.id and .contextId == $task.contextId)) and
  ($statuses | map(.status.state)) == ["TASK_STATE_WORKING", "TASK_STATE_COMPLETED"] and
  .[-1].statusUpdate.status.state == "TASK_STATE_COMPLETED" and
  ($chunks | length) >= 2 and
  ($chunks[0].append // false) == false and
  (all($chunks[1:][]; .append == true)) and
  ($chunks[0].artifact.artifactId | type == "string" and length > 0) and
  (all($chunks[]; .artifact.artifactId == $chunks[0].artifact.artifactId)) and
  (all($chunks[:-1][]; (.lastChunk // false) == false)) and
  $chunks[-1].lastChunk == true and
  ([$chunks[-1].artifact.parts[].text] | join("")) == "" and
  (all($chunks[].artifact.parts[]; has("text"))) and
  ([$chunks[].artifact.parts[].text] | join("") | gsub("^\\s+|\\s+$"; "")) == $marker
) then {taskId: $task.id, contextId: $task.contextId, chunks: ($chunks | length)}
else error("Demo stream contract failed") end
