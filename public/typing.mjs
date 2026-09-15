// A single contiguous edit covers ordinary insertions and replacements without a patch engine.
export function editBetween(before,after){
  let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  let end=0;while(end<before.length-start&&end<after.length-start&&before.at(-1-end)===after.at(-1-end))end++;
  return {prefix:before.slice(0,start),insert:after.slice(start,after.length-end),suffix:end?after.slice(-end):''};
}
export function codeAt(edit,progress){return edit.prefix+edit.insert.slice(0,Math.floor(edit.insert.length*Math.max(0,Math.min(1,progress))))+edit.suffix;}
