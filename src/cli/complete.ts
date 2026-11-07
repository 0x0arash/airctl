import { COMMANDS } from "./parse.js";

const COMMAND_LIST = COMMANDS.join(" ");

const FLAGS = [
  "--json",
  "--quiet",
  "--verbose",
  "--watch",
  "--all",
  "--yes",
  "--force",
  "--help",
  "--version",
  "--project",
  "--port",
  "--config",
].join(" ");

export function completionScript(shell: string): string {
  switch (shell) {
    case "zsh":
      return zshCompletion();
    case "fish":
      return fishCompletion();
    case "powershell":
    case "pwsh":
      return powershellCompletion();
    default:
      return bashCompletion();
  }
}

function bashCompletion(): string {
  return [
    "# airctl bash completion",
    "_airctl() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    '  local prev="${COMP_WORDS[COMP_CWORD-1]}"',
    "  COMPREPLY=()",
    "  if [[ ${COMP_CWORD} -eq 1 ]]; then",
    `    COMPREPLY=( $(compgen -W "${COMMAND_LIST}" -- "$cur") )`,
    "    return",
    "  fi",
    '  case "$prev" in',
    '    --project|--config) COMPREPLY=( $(compgen -f -- "$cur") ); return ;;',
    '    --port|explain) COMPREPLY=( $(compgen -W ":3000 :5173 :8080" -- "$cur") ); return ;;',
    '    stop) COMPREPLY=( $(compgen -W ":3000 :5173 --yes --force" -- "$cur") ); return ;;',
    '    complete) COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "$cur") ); return ;;',
    "  esac",
    `  COMPREPLY=( $(compgen -W "${FLAGS}" -- "$cur") )`,
    "}",
    "complete -F _airctl airctl",
    "",
  ].join("\n");
}

function zshCompletion(): string {
  return `#compdef airctl
_airctl() {
  local -a commands
  commands=(
    'status:Discover and show local services'
    'scan:Force a fresh discovery scan'
    'explain:Explain what owns a port'
    'inspect:Inspect a process'
    'projects:List detected projects'
    'services:List services'
    'graph:Show inferred service topology'
    'open:Open a project directory'
    'stop:Stop a process, port, or project'
    'refresh:Refresh discovery cache'
    'doctor:Diagnose AirCtl and the local environment'
    'config:Show effective configuration'
    'ui:Start the local web UI'
    'tui:Interactive terminal view'
    'logs:Show recent discovery activity'
    'version:Print version'
    'help:Show help'
    'complete:Print a shell completion script'
  )
  _arguments -C \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-v --verbose)'{-v,--verbose}'[Debug logs on stderr]' \\
    '(-q --quiet)'{-q,--quiet}'[Minimal output]' \\
    '--json[Machine-readable output]' \\
    '(-w --watch)'{-w,--watch}'[Refresh continuously]' \\
    '(-a --all)'{-a,--all}'[Include system services]' \\
    '(-y --yes)'{-y,--yes}'[Confirm destructive actions]' \\
    '--force[Use forceful termination]' \\
    '--project[Filter by project]:project:' \\
    '--port[Filter by port]:port:' \\
    '--config[Config file path]:file:_files' \\
    '1:command:->cmds' \\
    '*::arg:->args'
  case $state in
    cmds) _describe 'command' commands ;;
    args)
      case $words[1] in
        complete) _values 'shell' bash zsh fish powershell ;;
        explain) _message 'port (e.g. :3000)' ;;
        stop) _message 'pid, :port, or project' ;;
        inspect) _message 'pid' ;;
        open) _message 'project' ;;
      esac
      ;;
  esac
}
_airctl
`;
}

function fishCompletion(): string {
  const lines = [
    "complete -c airctl -f",
    ...COMMANDS.filter((c) => c !== "complete").map(
      (c) => `complete -c airctl -n "__fish_use_subcommand" -a ${c}`,
    ),
    'complete -c airctl -n "__fish_use_subcommand" -a complete',
    "complete -c airctl -l json -d 'Machine-readable output'",
    "complete -c airctl -s q -l quiet",
    "complete -c airctl -s v -l verbose",
    "complete -c airctl -s w -l watch",
    "complete -c airctl -s a -l all",
    "complete -c airctl -s y -l yes",
    "complete -c airctl -l force",
    "complete -c airctl -l project -r",
    "complete -c airctl -l port -r",
    "complete -c airctl -l config -r",
    'complete -c airctl -n "__fish_seen_subcommand_from complete" -a "bash zsh fish powershell"',
  ];
  return `${lines.join("\n")}\n`;
}

function powershellCompletion(): string {
  return `Register-ArgumentCompleter -Native -CommandName airctl -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $cmds = '${COMMAND_LIST}'.Split(' ')
  $flags = '${FLAGS}'.Split(' ')
  $tokens = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
  if ($tokens.Count -le 1) {
    $cmds + $flags | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }
  if ($tokens[1] -eq 'complete') {
    @('bash','zsh','fish','powershell') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }
  $flags | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;
}
