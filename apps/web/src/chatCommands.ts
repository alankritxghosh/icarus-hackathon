/**
 * The things a person can ask of the view in plain words. Everything else they type is a request to design or change
 * the building. A small closed set, matched on whole phrases so an ordinary design request is never mistaken for one.
 */
export type ViewCommand =
  | { kind: "real"; on: boolean }
  | { kind: "mode"; mode: "orbit" | "plan" | "eye" }
  | { kind: "ceiling"; show: boolean }
  | { kind: "export" }
  | { kind: "export_plan" }
  | { kind: "new" };

const t = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "");

export function viewCommand(text: string): ViewCommand | undefined {
  const s = t(text);
  if (
    /^(stop|turn off|disable|exit)( the)? (realistic|real|ray ?tracing|path ?tracing)( mode)?$|^back to (the )?(quick|fast|simple|preview)( view| mode)?$/.test(
      s,
    )
  )
    return { kind: "real", on: false };
  if (
    /^(please )?(make it real(istic)?|make this real(istic)?|realistic( mode)?|render it( for real)?|photo ?realistic( mode)?|turn on realistic( mode)?|ray ?trace it|path ?trace it)$/.test(
      s,
    )
  )
    return { kind: "real", on: true };
  if (
    /^(walk (me )?(in|inside|through)|step (in|inside)|go inside|take me inside|eye level|inside view|walk in)$/.test(
      s,
    )
  )
    return { kind: "mode", mode: "eye" };
  if (
    /^(top view|plan view|floor ?plan( view)?|show (me )?the (floor ?plan|plan)|from above|view from above)$/.test(
      s,
    )
  )
    return { kind: "mode", mode: "plan" };
  if (
    /^(3d( view)?|orbit( view)?|outside( view)?|go outside|back outside|overview|exterior( view)?)$/.test(
      s,
    )
  )
    return { kind: "mode", mode: "orbit" };
  if (/^(show|add|put( back)?|turn on)( the)? ceiling$/.test(s))
    return { kind: "ceiling", show: true };
  if (/^(hide|remove|take off|turn off)( the)? ceiling$/.test(s))
    return { kind: "ceiling", show: false };
  if (
    /^(export|download|save)( the| my| this)? (plan|floor ?plan|cad (file|drawing)|dxf)( (as|for) (dxf|cad))?$|^(give me|get) (the|my)? ?(cad (file|drawing)|dxf)$/.test(
      s,
    )
  )
    return { kind: "export_plan" };
  if (
    /^(export|download|save)( it| this| the model| the 3d model)?( (for|to|into|as|in) (blender|a file|glb|gltf|\.glb))?$|^(export|download|open) (for|in|to) blender$|^(give me|get) (the )?(glb|3d file)$/.test(
      s,
    )
  )
    return { kind: "export" };
  if (/^(new( office| design| project)?|start (over|again|fresh)|clear( it)?)$/.test(s))
    return { kind: "new" };
  return undefined;
}
