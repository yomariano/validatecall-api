# Trades outreach prompt validation — 2026-09-13

Assistant ff941ee3-112d-4c56-bc74-ec13c209ac71 in the mariano@validatecall.com workspace changed from the owner test script to **VoiceFleet — Trades Demo Outreach**. Business instructions and GPT Live speaking instructions are versioned in voicefleet-trades-outreach.md. Model remains gpt-live-1 with gpt-5.6-luna, low reasoning, Marin.

Public facts were checked against VoiceFleet's homepage, pricing and book-demo page. This is a sales conversation with AI disclosure, permission to continue, trade-specific discovery, relevant examples, direct pricing answers when requested and an agreed next step toward a demo. The agent does not have calendar, email, SMS or suppression tools; it cannot claim those actions succeeded.

Three synthetic **voice** scenarios run through AssistantFleet's real audio path, without Telnyx calls to people:

- Interested plumber: discover missed-enquiry needs, answer price, discuss a demo, and distinguish a booking request from a confirmed meeting.
- Busy electrician on a ladder: stop the pitch without another qualifying question.
- Clear do-not-call request: acknowledge and stop selling.

The initial revision passed seven automated assertions across the three cases. Manual transcript review nevertheless found inappropriate "I'm checking that" filler and loose callback wording. Revision 3 adds explicit instructions to the separate GPT Live speaking layer to avoid imaginary lookups, delivery promises and unsolicited future contact, and to delegate end_call after a farewell. This illustrates why judge results alone are insufficient.

Simulation callers are generated and may interrupt, deviate from their assigned scenario or end early. These are bounded behavioural checks, not evidence of sales conversion. No new real outbound calls were placed; outbound and schedulers remained disabled.

## Revision 3 results

- VoiceFleet outreach — Interested plumber: run `8ea85165-47d6-41ad-ad86-0104c9cf4029`, completed, automated checks passed=True.
- VoiceFleet outreach — Busy electrician: run `99639996-e3f0-458b-ae48-68fb699d2be9`, completed, automated checks passed=True.
- VoiceFleet outreach — Do not call: run `221b16f6-c0ae-42d7-bb9c-a050db984ef4`, completed, automated checks passed=True.

All seven automated assertions passed again. Manual review confirms the busy prospect received a brief farewell and assistant_ended_call; the refusal received an acknowledgement without further selling. The interested prospect heard the starting price and demo confirmation remained with Mariano.

Remaining speech-quality issue: despite both instruction layers, GPT Live still generated some unneeded lookup filler (for example, “I’m checking on that”). The simulated interested prospect also ended before the assistant could fully confirm the proposed time/timezone. Do not interpret passing judge checks as polished human sales performance or a validated booking flow. A human audition and a real booking integration remain the next improvements.
