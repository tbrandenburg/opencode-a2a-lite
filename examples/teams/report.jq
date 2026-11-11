# Usage: jq -rs -f report.jq receipts.jsonl
# Prints counts, tool names, states and timings only. Peers, tasks and connections are numbered.
def secs: (sub("\\.[0-9]+"; "") | fromdateiso8601) + (capture("\\.(?<f>[0-9]+)").f // "0" | "0." + . | tonumber);
def peer: if test("^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:[0-9]+)?/?$") then sub("^https?://"; "") | rtrimstr("/") else "other" end;
def word: if type == "string" and test("\\A[A-Za-z0-9_.-]{1,64}\\z") then . else "other" end;
def ms: . * 1000 | round / 1000;
def count: group_by(.) | map({k: .[0], n: length}) | sort_by(-.n, .k);

. as $events
| ([$events[] | select(.event == "call" or .event == "result")]
    | group_by([.connection, .id])
    | map({c: (map(select(.event == "call"))[0]), r: (map(select(.event == "result"))[0])} | select(.c))) as $pairs
| ([$events[] | select(.event == "rejected")]) as $rejected
| ([$events[] | select(.event == "call" or .event == "rejected") | .connection] | unique) as $connections
| ([$pairs[] | select(.c.taskHash and .r.taskId) | {(.c.taskHash): .r.taskId}] | add // {}) as $known
| ($pairs | map(. + {task: (.r.taskId // $known[.c.taskHash // ""] // .c.taskHash // null)})) as $linked
| ([$linked[] | .task | values] | unique) as $tasks
| "Receipt events: \($events | length)",
  "",
  "Calls per tool and peer",
  ([$pairs[] | "\(.c.tool | word)\t\(.c.peer // "-" | peer)"] | count | .[] | "  \(.n)\t\(.k)"),
  "",
  "Durations per tool (call to result, seconds)",
  ($pairs | map(select(.r)) | group_by(.c.tool)[]
    | (map(.r.at | secs) as $end | map(.c.at | secs) as $start
       | [range(0; length) | $end[.] - $start[.]]) as $d
    | "  \(.[0].c.tool | word)\tn=\(length)\tavg=\($d | add / length | ms)\tmax=\($d | max | ms)"),
  "",
  "Polls per task (a2a_get_task)",
  ($linked | map(select(.c.tool == "a2a_get_task" and .task)) | group_by(.task)[]
    | "  task-\(. as $g | $tasks | index($g[0].task) + 1)\t\(length)"),
  "",
  "Send to completed",
  ($tasks | to_entries[] | .key as $i | .value as $t
    | ($linked | map(select(.task == $t))) as $g
    | ([$g[] | select(.c.tool | test("^a2a_send_(message|streaming)$")) | .c.at | secs] | min) as $sent
    | ([$g[] | select(.r.state == "TASK_STATE_COMPLETED") | .r.at | secs] | min) as $done
    | select($sent != null)
    | "  task-\($i + 1)\t\(if $done == null then "not completed" else "\($done - $sent | ms)s" end)\tlast state \([$g[] | .r.state // empty] | last // "-" | word)"),
  "",
  "Rejections",
  (if ($rejected | length) == 0 then "  0" else ($rejected | map("\(.tool | word)\t\(.reason | word)") | count | .[] | "  \(.n)\t\(.k)") end),
  "",
  "Attempts against the 40-call ceiling (calls plus rejections)",
  ($connections | to_entries[] | .value as $c
    | ([$events[] | select((.event == "call" or .event == "rejected") and .connection == $c)] | length) as $n
    | "  connection-\(.key + 1)\t\($n)/40")
