# Security Policy

## Supported versions

Security fixes are accepted against the latest released version of AirCtl.

## What AirCtl is

AirCtl inspects local processes, sockets, and project files, and can terminate processes at the user's explicit request. Treat it as a privileged local developer tool.

## Reporting a vulnerability

Please **do not** open a public issue for security reports.

Email the maintainers using a private channel, or open a GitHub security advisory if the repository has advisories enabled. Include:

- a description of the issue
- steps to reproduce
- affected versions
- an assessment of impact

You should receive an acknowledgement within 7 days.

## Security guarantees AirCtl aims to keep

- Data stays on the local machine. No telemetry by default. No cloud dependency.
- The HTTP UI/API binds to loopback unless the user changes configuration, and AirCtl refuses non-loopback binds for the MVP.
- Mutating API calls require a random session token and origin checks.
- Environment variables are not displayed or stored.
- Command lines are redacted when they look secret-bearing.
- Process termination is never automatic and never defaults to SIGKILL.
- User-controlled strings are not interpolated into a shell.

## Known residual risks

- Any local process on the same machine may be able to talk to a localhost server. The token and origin checks reduce casual CSRF; they are not a multi-user access-control system.
- On some platforms, listing other users' processes requires elevated privileges. AirCtl does not request elevation by default.
- Health checks make conservative local GET/TCP probes. Disable them in config if that is undesirable on your machine.
