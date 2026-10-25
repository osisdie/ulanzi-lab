// The "ulanzi-lab Voice" profile (a separate Ulanzi profile, made by scripts/voice-profile.mjs).
// Page 1: record → transcript. Keys are "col_row"; 3_2 is the wide key; 4_0 keeps the HITL light like every page.
export const VOICE_PAGES = [
  {
    name: 'Voice',
    keys: [
      ['0_0', 'voice', { part: 'rec' }], ['1_0', 'voice', { part: 'save' }], ['2_0', 'voice', { part: 'finish' }], ['3_0', 'voice', { part: 'cancel' }], ['4_0', 'hitl', { style: 'mascot' }],
      ['0_1', 'voice', { part: 'last' }], ['1_1', 'voice', { part: 'copy' }], ['2_1', 'media', { part: 'mic' }], ['3_1', 'voice', { part: 'retry' }], ['4_1', 'voice', { part: 'status' }],
      ['0_2', 'voice', { part: 'lang' }], ['1_2', 'voice', { part: 'folder' }], ['2_2', 'focus', { part: 'clock' }], ['3_2', 'voice', { part: 'wide' }],
    ],
  },
];
