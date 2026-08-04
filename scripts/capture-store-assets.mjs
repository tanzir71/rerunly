import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

function executable() {
  const expected = chromium.executablePath();
  if (existsSync(expected)) return expected;
  const regular = expected.replace('chromium_headless_shell-', 'chromium-').replace('chrome-headless-shell-win64', 'chrome-win64').replace('chrome-headless-shell.exe', 'chrome.exe');
  return existsSync(regular) ? regular : undefined;
}

const shots = [
  { mode: 'run', file: '01-live-visual-verification.png', eyebrow: 'See every step', title: 'A browser agent that checks its work.', detail: 'Every action produces a fresh screenshot and a separate verification result.', page: '<div class="price"><span>Best verified price</span><strong>$184.20</strong><em>Ready for quote</em></div><div class="form"><label>Supplier quote</label><div class="input">$184.20 <b>✓ Valid</b></div><button>Prepare quote</button></div>' },
  { mode: 'recovery', file: '02-visual-error-recovery.png', eyebrow: 'Recover with evidence', title: 'It sees what went wrong—and changes course.', detail: 'Rerunly does not blindly repeat a failed click when the rendered page says otherwise.', page: '<div class="form dim"><label>Supplier quote</label><div class="input">$184.20</div><button>Continue</button></div><div class="dialog"><small>Unexpected dialog</small><strong>Review needed</strong><p>This overlay covered the next action.</p><button>Dismiss</button></div>' },
  { mode: 'tasks', file: '03-saved-reusable-tasks.png', eyebrow: 'Save once', title: 'Replay proven browser work with one click.', detail: 'Tasks keep their instructions, visible success criteria, origins, model, and variables.', page: '<h3>This week</h3><div class="rows"><p><i></i> Compare supplier prices <b>Ready</b></p><p><i></i> Check inventory status <b>Ready</b></p><p><i></i> Prepare weekly form <b>Ready</b></p></div>' },
  { mode: 'vault', file: '04-encrypted-device-vault.png', eyebrow: 'Protected by design', title: 'Task secrets stay out of model context.', detail: 'Values are encrypted locally and sensitive field regions are redacted before visual verification.', page: '<div class="form"><label>Work email</label><div class="input redacted">████████████████</div><small>Protected region redacted locally</small><button>Continue safely</button></div>' },
  { mode: 'settings', file: '05-openrouter-lmstudio-models.png', eyebrow: 'Your model, your choice', title: 'Run remotely or keep vision local.', detail: 'Connect a compatible OpenRouter model or a vision + tool model in LM Studio.', page: '<div class="choice"><div><strong>OpenRouter</strong><span>Remote visual processing</span></div><div class="selected"><strong>LM Studio</strong><span>Local visual processing</span></div></div><p class="privacy">No Rerunly backend · No telemetry · No cloud sync</p>' }
];

const extensionPath = path.resolve('.output/chrome-mv3');
const outputPath = path.resolve('store-assets');
await mkdir(outputPath, { recursive: true });
const context = await chromium.launchPersistentContext(path.resolve('.wxt/store-profile'), {
  headless: true,
  executablePath: executable(),
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});

try {
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  for (const shot of shots) {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 420, height: 800 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?preview=${shot.mode}`);
    await panel.waitForTimeout(250);
    const panelPng = await panel.screenshot();
    await panel.close();

    const canvas = await context.newPage();
    await canvas.setViewportSize({ width: 1280, height: 800 });
    await canvas.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;width:1280px;height:800px;overflow:hidden;color:#1e1e1c;background:#e8dece;font-family:Arial,sans-serif}
      main{position:relative;display:grid;grid-template-columns:1fr 420px;height:800px}.story{position:relative;padding:54px 52px}.story::after{content:"";position:absolute;inset:-180px 210px 280px -230px;border-radius:50%;background:radial-gradient(circle,#c9caef 0,rgba(201,202,239,.64) 36%,transparent 69%)}
      .brand{position:relative;z-index:2;display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700}.mark{position:relative;width:38px;height:38px;display:grid;place-items:center;overflow:hidden;color:#222;border:1px solid #bdafa1;border-radius:10px;background:#f5eddf;font-family:Georgia,serif;font-size:21px;font-style:italic}.mark::after{content:"";position:absolute;inset:6px;border:1.5px solid #d97757;border-left-color:transparent;border-radius:50%;transform:rotate(-20deg)}
      .eyebrow{position:relative;z-index:2;margin-top:55px;color:#92503c;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.eyebrow::before{content:"";display:inline-block;width:6px;height:6px;margin-right:9px;border-radius:50%;background:#d97757;box-shadow:0 0 0 4px #d9775722}
      .story h1{position:relative;z-index:2;max-width:660px;margin:14px 0 15px;font-family:Georgia,serif;font-size:50px;font-weight:400;line-height:1.01;letter-spacing:-.045em}.story>p{position:relative;z-index:2;max-width:600px;margin:0;color:#625f58;font-size:17px;line-height:1.48}
      .browser{position:absolute;z-index:2;left:52px;right:45px;bottom:42px;height:292px;overflow:hidden;border:1px solid #8e8b85;border-radius:17px;background:#f8fafc;color:#242424;box-shadow:0 26px 62px #594c3d33}.bar{height:42px;display:flex;align-items:center;padding:0 13px;gap:7px;background:#2b2c2f}.bar i{width:8px;height:8px;border-radius:50%;background:#737373}.bar i:first-child{background:#df6a62}.bar i:nth-child(2){background:#d7a44f}.bar i:nth-child(3){background:#5db06c}.url{flex:1;margin-left:10px;padding:7px 13px;color:#aaa;border-radius:8px;background:#202124;font-family:monospace;font-size:9px}.page{position:relative;height:250px;padding:23px}
      .panel{position:relative;z-index:5;height:800px;border-left:1px solid #9a958d;box-shadow:-24px 0 70px #574b4233}.panel img{display:block;width:420px;height:800px}
      .price{display:flex;align-items:center;gap:18px;padding:14px 17px;border:1px solid #bed6c9;border-radius:11px;background:#edf6f1}.price span{color:#5c7165;font-size:11px}.price strong{color:#235e45;font-size:27px}.price em{margin-left:auto;color:#2f7255;font-size:10px}.form{margin-top:16px;padding:16px;border:1px solid #d5d7dd;border-radius:11px;background:white}.form label{display:block;margin-bottom:7px;color:#696e79;font-size:10px}.input{padding:10px;border:1px solid #9da7b8;border-radius:8px;font-weight:700}.input b{float:right;color:#2f7255;font-size:10px}.form button,.dialog button{margin-top:11px;padding:9px 13px;color:white;border:0;border-radius:999px;background:#292825}.form small{display:block;margin-top:8px;color:#77736b}.redacted{color:#d97757;background:#292825;letter-spacing:2px}.dim{opacity:.4}.dialog{position:absolute;top:45px;right:95px;left:135px;padding:19px;border:1px solid #777470;border-radius:13px;background:white;box-shadow:0 15px 40px #3333}.dialog small{color:#d97757;font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.dialog strong{display:block;margin-top:5px}.dialog p{color:#716e67;font-size:11px}.rows p{margin:7px 0;padding:13px;border:1px solid #d8d6cf;border-radius:9px}.rows i{display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:#d97757}.rows b{float:right;color:#2f7255;font-size:10px}.choice{display:grid;grid-template-columns:1fr 1fr;gap:12px}.choice>div{display:flex;flex-direction:column;padding:22px;border:1px solid #cbc7be;border-radius:13px;background:white}.choice .selected{border:2px solid #6d806f;background:#edf6f1}.choice span{margin-top:5px;color:#77736b;font-size:10px}.privacy{padding:13px;border-radius:9px;background:#efede7;color:#706d66;font-family:monospace;font-size:10px}
    </style><main><section class="story"><div class="brand"><div class="mark">r</div>Rerunly</div><div class="eyebrow">${shot.eyebrow}</div><h1>${shot.title}</h1><p>${shot.detail}</p><div class="browser"><div class="bar"><i></i><i></i><i></i><div class="url">workspace.example/task</div></div><div class="page">${shot.page}</div></div></section><aside class="panel"><img src="data:image/png;base64,${panelPng.toString('base64')}" /></aside></main>`);
    await canvas.screenshot({ path: path.join(outputPath, shot.file) });
    await canvas.close();
  }
} finally {
  await context.close();
}
