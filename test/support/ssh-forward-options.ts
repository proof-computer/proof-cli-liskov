export function hasSshForwardOptions(line: string): boolean {
  // Managed output appends SSH arguments after the ticket notice, beyond the identity path.
  const options = line.split("; one-time ticket not minted").at(-1) ?? "";
  return options.split(/\s+/u).some((token) =>
    /^(?:-[LD]|(?:-o)?ExitOnForwardFailure(?:=|$))/u.test(token)
  );
}
