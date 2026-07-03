# Budget — SpeakUp

- Month: 2026-07
- Total monthly limit: USD 80
- Warning threshold: USD 60
- Stop-new-experiments threshold: USD 70
- Active agent ceiling: USD 57
- Product/hosting room: USD 23

## Active agent team

| Provider | Role | Billing type | Monthly ceiling | Verification |
|---|---|---|---:|---|
| Claude Code Pro | Lead | fixed subscription | 20 | Local auth confirms Claude Pro |
| Codex | Engineering worker | fixed subscription | 21 | Confirmed USD 21/month by Phuong on 2026-07-03 |
| Cline with GLM 5.2 or Kimi | Engineering worker in VS Code | fixed subscription | 6 | Amount supplied by Phuong |
| Lonewolf with DeepSeek V4 Flash | Read-only bridge | metered | 10 | Model confirmed; external API-key cap not yet lowered |
| **Active agent total** |  |  | **57** | Confirmed |

## Inactive or legacy cost

| Provider | Status | Possible July amount | Required action |
|---|---|---:|---|
| Cursor | Cancelled | 0 | Confirmed cancelled by Phuong on 2026-07-03; no July charge |

## Metered-cost controls

- Lonewolf may spend at most USD 10 per month.
- Lonewolf uses `deepseek/deepseek-v4-flash` through OpenRouter.
- Observed OpenRouter usage on 2026-07-03: USD 0 this month and approximately
  USD 0.0586 all-time.
- The current OpenRouter key still has a USD 100 non-resetting limit. This is not
  compliant with the new budget and must be changed to USD 10 resetting monthly
  in the OpenRouter key settings.
- Do not enable automatic paid fallback, automatic credit purchases, or a more
  expensive model without Phuong's explicit approval and a budget update.
- When a subscription rate limit is reached, checkpoint and wait; do not switch
  Claude, Codex, or Cline to pay-as-you-go API billing automatically.

## Budget gates

- At USD 60 total exposure: warn Phuong and freeze optional agent experiments.
- At USD 70: stop all new experiments; allow only approved production fixes.
- At USD 80: stop metered calls. A P0 exception requires Phuong's explicit choice.
- Claude checks this file before dispatching any metered task.
- Lonewolf reports cost and remaining room but has no authority to spend.

## Open confirmations

1. ~~Confirm the actual Codex subscription charge.~~ Done: USD 21/month.
2. ~~Confirm Cursor cancellation and July charge status.~~ Done: cancelled, no July charge.
3. Lonewolf OpenRouter key USD 10 monthly hard limit — Phuong will enforce today.

