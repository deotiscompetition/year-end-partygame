"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyInput, gaugeBand, MEMORY_GRID, MEMORY_LIVES, memoryPattern, newRun, question, RACE_METERS, reflexDelay, REFLEX_NO_RESPONSE_MS,
  type GameDef, type GameInput, type Run,
} from "@/game/engine";
import { INPUT_FLUSH_MS, type ClientMessage } from "@/game/protocol";

type Props = {
  def: GameDef;
  seed: number;
  startedAt: number;
  initialRun: Run | null;
  playerId: string;
  offset: number;
  timeLeft: number;
  send: (message: ClientMessage) => boolean;
};

type Pending = { at: number; input: GameInput };
const MAX_BATCH = 40;

/** 입력은 화면에 바로 반영하고, 서버에는 묶어서 보냅니다. 규칙 함수가 같아 양쪽 결과가 일치합니다. */
export function GamePad({ def, seed, startedAt, initialRun, playerId, offset, timeLeft, send }: Props) {
  const [run, setRun] = useState<Run>(() => initialRun ?? newRun());
  const pending = useRef<Pending[]>([]);
  const runRef = useRef(run);

  const flush = useCallback(() => {
    if (pending.current.length === 0) return;
    const inputs = pending.current.slice(0, MAX_BATCH);
    if (send({ t: "input", inputs })) pending.current.splice(0, inputs.length);
  }, [send]);

  useEffect(() => {
    const id = setInterval(flush, INPUT_FLUSH_MS);
    return () => {
      clearInterval(id);
      flush();
    };
  }, [flush]);

  const act = useCallback((input: GameInput) => {
    const at = Date.now() + offset;
    const next = applyInput(def, runRef.current, input, seed, at, startedAt);
    if (next === runRef.current) return runRef.current;
    runRef.current = next;
    setRun(next);
    const last = pending.current.at(-1);
    // 연타는 한 건으로 합쳐 메시지를 줄입니다.
    if (input.type === "count" && last?.input.type === "count" && last.input.n < 30) last.input = { type: "count", n: last.input.n + input.n };
    else pending.current.push({ at, input });
    // 완주 순간은 바로 보내 큰 화면이 늦지 않게 합니다.
    if (next.finishedAt !== null || next.out) flush();
    return next;
  }, [def, flush, offset, seed, startedAt]);

  const done = run.finishedAt !== null || run.out;

  return (
    <section className="game-surface flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="font-bold">{def.name}</span>
        <span className="rounded-full bg-gold px-3 text-lg font-black tabular-nums text-night">{timeLeft}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {done ? <Finished def={def} run={run} /> : <Controls def={def} run={run} act={act} seed={seed} startedAt={startedAt} offset={offset} playerId={playerId} />}
      </div>
    </section>
  );
}

function Finished({ def, run }: { def: GameDef; run: Run }) {
  const message = run.out ? (def.kind === "reflex" ? "앗, 너무 빨랐어요!" : "기회를 모두 썼어요") : "완료!";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="pop text-4xl font-black text-gold">{message}</p>
      <p className="text-mist">결과를 기다려 주세요.</p>
    </div>
  );
}

type Controls = { def: GameDef; run: Run; act: (input: GameInput) => Run; seed: number; startedAt: number; offset: number; playerId: string };

function Controls(props: Controls) {
  switch (props.def.kind) {
    case "counter":
      if (props.def.input === "shake") return <Shake {...props} />;
      if (props.def.input === "rub") return <Rub {...props} />;
      return <Tap {...props} />;
    case "race": return <Race {...props} />;
    case "gauge": return props.def.input === "tilt" ? <Tilt {...props} /> : <Gauge {...props} />;
    case "reflex": return <Reflex {...props} />;
    case "memory": return <Memory {...props} />;
    case "updown": return <UpDown {...props} />;
    case "quiz": return <Quiz {...props} />;
  }
}

function Tap({ run, act }: Controls) {
  return (
    <button onPointerDown={() => act({ type: "count", n: 1 })} className="flex size-full flex-col items-center justify-center bg-gold text-night active:bg-[#ffe08a]">
      <span className="text-8xl font-black tabular-nums">{run.value}</span>
      <span className="text-2xl font-bold">계속 누르세요!</span>
    </button>
  );
}

const SHAKE_THRESHOLD = 16;
const SHAKE_GAP_MS = 120;

function Shake({ run, act }: Controls) {
  const [sensing, setSensing] = useState(false);
  useEffect(() => {
    let last = 0;
    function onMotion(event: DeviceMotionEvent) {
      const a = event.acceleration ?? event.accelerationIncludingGravity;
      if (!a) return;
      setSensing(true);
      const size = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const threshold = event.acceleration ? SHAKE_THRESHOLD : SHAKE_THRESHOLD + 10;
      if (size > threshold && event.timeStamp - last > SHAKE_GAP_MS) {
        last = event.timeStamp;
        act({ type: "count", n: 1 });
      }
    }
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [act]);
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="text-8xl font-black tabular-nums text-gold">{run.value}</span>
      <span className="text-2xl font-bold">폰을 흔드세요!</span>
      {!sensing && (
        <button onPointerDown={() => act({ type: "count", n: 1 })} className="rounded-xl border border-line px-6 py-4 text-mist">
          센서가 안 되면 여기를 누르세요
        </button>
      )}
    </div>
  );
}

const RUB_MIN_PX = 14;

function Rub({ run, act }: Controls) {
  const track = useRef({ anchor: 0, direction: 0 });
  return (
    <div
      className="flex size-full flex-col items-center justify-center gap-2 bg-panel text-center"
      onPointerDown={event => { track.current = { anchor: event.clientX, direction: 0 }; }}
      onPointerMove={event => {
        if (event.buttons === 0 && event.pointerType === "mouse") return;
        const delta = event.clientX - track.current.anchor;
        if (Math.abs(delta) < RUB_MIN_PX) return;
        const direction = Math.sign(delta);
        if (direction !== track.current.direction) act({ type: "count", n: 1 });
        track.current = { anchor: event.clientX, direction };
      }}
    >
      <span className="text-8xl font-black tabular-nums text-gold">{run.value}</span>
      <span className="text-2xl font-bold">← 좌우로 문지르세요 →</span>
    </div>
  );
}

function Race({ run, act }: Controls) {
  const pad = "flex flex-1 items-center justify-center rounded-2xl text-7xl font-black transition-colors";
  const foot = (side: "L" | "R") => (
    <button onPointerDown={() => act({ type: "foot", foot: side })} aria-label={side === "L" ? "왼발" : "오른발"} className={clsx(pad, run.lastFoot === side ? "bg-panel text-mist" : "bg-gold text-night")}>
      {side}
    </button>
  );
  return (
    <div className="flex size-full flex-col gap-3 p-3">
      <div className="text-center">
        <p className="text-5xl font-black tabular-nums">{run.value}m</p>
        <div className="mt-2 h-3 rounded-full bg-panel"><div className="h-full rounded-full bg-gold" style={{ width: `${(run.value / RACE_METERS) * 100}%` }} /></div>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">{foot("L")}{foot("R")}</div>
    </div>
  );
}

const GAUGE_TICK_MS = 50;
const GAUGE_REPORT_MS = 200;

/** 움직이는 구간 안에 머문 시간을 잽니다. step은 다음 위치(0~1)를 돌려주며, 렌더마다 새 함수여도 타이머는 유지됩니다. */
function useBandTimer({ act, seed, startedAt, offset }: Controls, start: number, step: (level: number) => number) {
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; });
  const [view, setView] = useState({ level: start, low: 0, high: 0, inBand: false });
  useEffect(() => {
    let level = start;
    let inside = 0;
    let sinceReport = 0;
    const id = setInterval(() => {
      level = Math.max(0, Math.min(1, stepRef.current(level)));
      const band = gaugeBand(seed, Date.now() + offset - startedAt);
      const inBand = level >= band.low && level <= band.high;
      if (inBand) inside += GAUGE_TICK_MS;
      sinceReport += GAUGE_TICK_MS;
      if (sinceReport >= GAUGE_REPORT_MS) {
        sinceReport = 0;
        if (inside > 0) act({ type: "gauge", ms: inside });
        inside = 0;
      }
      setView({ level, low: band.low, high: band.high, inBand });
    }, GAUGE_TICK_MS);
    return () => clearInterval(id);
  }, [act, offset, seed, start, startedAt]);
  return view;
}

function Gauge(props: Controls) {
  const { run } = props;
  const holding = useRef(false);
  const view = useBandTimer(props, 0.3, level => level + (holding.current ? 0.022 : -0.016));
  return (
    <button
      className="flex size-full items-center justify-center gap-8 p-6"
      onPointerDown={() => { holding.current = true; }}
      onPointerUp={() => { holding.current = false; }}
      onPointerCancel={() => { holding.current = false; }}
      onPointerLeave={() => { holding.current = false; }}
    >
      <span className="relative h-full w-20 overflow-hidden rounded-2xl bg-panel">
        <span className="absolute inset-x-0 bg-gold/30 ring-2 ring-gold" style={{ bottom: `${view.low * 100}%`, height: `${(view.high - view.low) * 100}%` }} />
        <span className={clsx("absolute inset-x-1 h-2 rounded-full", view.inBand ? "bg-[#4fd88a]" : "bg-berry")} style={{ bottom: `${view.level * 100}%` }} />
      </span>
      <span className="flex flex-col gap-2 text-left">
        <span className="text-5xl font-black tabular-nums">{(run.value / 1000).toFixed(1)}초</span>
        <span className="text-xl font-bold">누르면 오르고<br />떼면 내려가요</span>
      </span>
    </button>
  );
}

/** 이 각도(도)만큼 기울이면 공이 끝에 닿습니다. 화면이 돌아가지 않을 만큼 작은 각도입니다. */
const TILT_RANGE_DEG = 25;
const TILT_SMOOTHING = 0.35;
const TILT_BUTTON_SPEED = 0.03;

function Tilt(props: Controls) {
  const { run } = props;
  const target = useRef<number | null>(null);
  const direction = useRef(0);
  const [sensing, setSensing] = useState(false);
  useEffect(() => {
    function onOrientation(event: DeviceOrientationEvent) {
      if (event.gamma === null) return;
      target.current = 0.5 + event.gamma / (2 * TILT_RANGE_DEG);
      setSensing(true);
    }
    window.addEventListener("deviceorientation", onOrientation);
    return () => window.removeEventListener("deviceorientation", onOrientation);
  }, []);
  const view = useBandTimer(props, 0.5, level => {
    if (target.current === null) return level + direction.current * TILT_BUTTON_SPEED;
    return level + (Math.max(0, Math.min(1, target.current)) - level) * TILT_SMOOTHING;
  });
  const hold = (label: string, value: number) => (
    <button
      className="flex-1 rounded-xl border border-line py-5 font-bold text-mist"
      onPointerDown={() => { direction.current = value; }}
      onPointerUp={() => { direction.current = 0; }}
      onPointerCancel={() => { direction.current = 0; }}
      onPointerLeave={() => { direction.current = 0; }}
    >
      {label}
    </button>
  );
  return (
    <div className="flex size-full flex-col items-center justify-center gap-6 p-6 text-center">
      <span className="text-6xl font-black tabular-nums">{(run.value / 1000).toFixed(1)}초</span>
      <div className="relative h-16 w-full overflow-hidden rounded-2xl bg-panel">
        <span className="absolute inset-y-0 bg-gold/30 ring-2 ring-gold" style={{ left: `${view.low * 100}%`, width: `${(view.high - view.low) * 100}%` }} />
        <span className={clsx("absolute top-1/2 size-10 -translate-1/2 rounded-full", view.inBand ? "bg-[#4fd88a]" : "bg-berry")} style={{ left: `${view.level * 100}%` }} />
      </div>
      <span className="text-xl font-bold">{sensing ? "폰을 좌우로 기울이세요" : "센서가 안 되면 버튼을 누르고 있으세요"}</span>
      {!sensing && <div className="flex w-full gap-3">{hold("← 왼쪽", -1)}{hold("오른쪽 →", 1)}</div>}
    </div>
  );
}

function Reflex({ act, seed, startedAt, offset, playerId }: Controls) {
  const [go, setGo] = useState(false);
  const goAt = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, startedAt + reflexDelay(seed, playerId) - (Date.now() + offset));
    const show = setTimeout(() => { goAt.current = performance.now(); setGo(true); }, wait);
    // 끝까지 안 누르면 가장 느린 기록으로 처리합니다.
    const miss = setTimeout(() => act({ type: "reflex", ms: REFLEX_NO_RESPONSE_MS }), wait + REFLEX_NO_RESPONSE_MS);
    return () => { clearTimeout(show); clearTimeout(miss); };
  }, [act, offset, playerId, seed, startedAt]);
  return (
    <button
      onPointerDown={() => act({ type: "reflex", ms: go ? performance.now() - goAt.current : null })}
      className={clsx("flex size-full items-center justify-center text-5xl font-black", go ? "bg-[#4fd88a] text-night" : "bg-berry")}
    >
      {go ? "지금!" : "기다리세요…"}
    </button>
  );
}

function Memory({ run, act, seed }: Controls) {
  const pattern = useMemo(() => memoryPattern(seed, run.index), [seed, run.index]);
  // 틀려도 같은 단계를 다시 보여 줍니다.
  const attempt = `${run.index}:${run.wrong}`;
  const [shownFor, setShownFor] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const showing = shownFor !== attempt;

  useEffect(() => {
    const id = setTimeout(() => { setShownFor(attempt); setPicked([]); }, 900 + pattern.length * 250);
    return () => clearTimeout(id);
  }, [attempt, pattern.length]);

  function tap(cell: number) {
    if (showing || picked.includes(cell)) return;
    const next = [...picked, cell];
    setPicked(next);
    if (next.length === pattern.length) act({ type: "memory", index: run.index, cells: next });
  }

  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-3">
      <p className="font-bold">{run.value + 1}단계 · 기회 {MEMORY_LIVES - run.wrong}번 · {showing ? "잘 보세요!" : `${pattern.length}칸을 누르세요`}</p>
      <div className="grid aspect-square w-full max-w-sm grid-cols-4 grid-rows-4 gap-2">
        {Array.from({ length: MEMORY_GRID }, (_, cell) => (
          <button
            key={cell}
            onPointerDown={() => tap(cell)}
            aria-label={`${cell + 1}번 칸`}
            className={clsx("rounded-xl", showing && pattern.includes(cell) ? "bg-gold" : picked.includes(cell) ? "bg-[#5aa2ff]" : "bg-panel")}
          />
        ))}
      </div>
    </div>
  );
}

function UpDown({ run, act }: Controls) {
  const [value, setValue] = useState("");
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 100;
  const hint = run.hint === "up" ? "업! 더 큰 숫자예요" : run.hint === "down" ? "다운! 더 작은 숫자예요" : "1~100 사이 숫자를 입력하세요";
  const press = (digit: string) => setValue(current => (current.length < 3 ? current + digit : current));
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-3">
      <p className="text-xl font-bold text-gold">{hint}</p>
      <p className="h-14 text-5xl font-black tabular-nums">{value}</p>
      <p className="text-sm text-mist">{run.value}회 시도</p>
      <div className="grid w-full max-w-xs grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digit => <Key key={digit} onPress={() => press(digit)}>{digit}</Key>)}
        <Key onPress={() => setValue("")}>지움</Key>
        <Key onPress={() => press("0")}>0</Key>
        <button
          disabled={!valid}
          onClick={() => { act({ type: "guess", value: parsed }); setValue(""); }}
          className="rounded-xl bg-gold py-3 text-lg font-bold text-night disabled:opacity-40"
        >
          확인
        </button>
      </div>
    </div>
  );
}

function Key({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return <button onClick={onPress} className="rounded-xl bg-panel py-3 text-2xl font-bold">{children}</button>;
}

function Quiz({ def, run, act, seed }: Controls) {
  const [locked, setLocked] = useState(false);
  const current = useMemo(() => question(def.id, seed, run.index), [def.id, seed, run.index]);

  function answer(choice: number) {
    if (locked) return;
    const before = run.wrong;
    const next = act({ type: "answer", index: run.index, choice });
    if (next.wrong > before) {
      setLocked(true);
      setTimeout(() => setLocked(false), def.penaltyMs ?? 500);
    }
  }

  const counter = <p className="text-center text-sm text-mist">{run.value}{def.goal ? ` / ${def.goal}` : ""}{def.unit}{locked && <b className="ml-2 text-berry">잠깐 멈춤!</b>}</p>;

  if (def.id === "mole") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 p-3">
        {counter}
        <div className="grid aspect-square w-full max-w-sm grid-cols-3 grid-rows-3 gap-3">
          {current.choices.map((_, hole) => (
            <button key={hole} onPointerDown={() => answer(hole)} aria-label={`${hole + 1}번 구멍`} className={clsx("rounded-full text-4xl", hole === current.answer ? "bg-gold text-night" : "bg-panel")}>
              {hole === current.answer && "●"}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (def.id === "keys") {
    const upcoming = Array.from({ length: 5 }, (_, i) => run.index + i).filter(index => !def.goal || index < def.goal);
    return (
      <div className="flex size-full flex-col gap-2 p-3">
        {counter}
        <div className="flex min-h-0 flex-1 flex-col-reverse gap-1">
          {upcoming.map(index => {
            const lane = question(def.id, seed, index).answer;
            return (
              <div key={index} className="grid min-h-0 flex-1 grid-cols-4 gap-1">
                {[0, 1, 2, 3].map(column => <span key={column} className={clsx("rounded-md", column === lane ? (index === run.index ? "bg-gold" : "bg-gold/30") : "bg-panel/40")} />)}
              </div>
            );
          })}
        </div>
        <div className="grid h-28 shrink-0 grid-cols-4 gap-1">
          {[0, 1, 2, 3].map(lane => <button key={lane} onPointerDown={() => answer(lane)} aria-label={`${lane + 1}번 건반`} className="rounded-xl bg-snow active:bg-gold" />)}
        </div>
      </div>
    );
  }

  if (def.id === "order") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 p-3">
        {counter}
        <div className="grid aspect-square w-full max-w-sm grid-cols-4 grid-rows-4 gap-2">
          {current.choices.map((label, cell) => {
            const passed = Number(label) <= run.index;
            return (
              <button key={label} disabled={passed} onPointerDown={() => answer(cell)} className={clsx("rounded-xl text-2xl font-black", passed ? "bg-panel/30 text-mist/40" : "bg-panel")}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex size-full flex-col justify-between gap-3 p-4">
      {counter}
      <div className="flex flex-col items-center gap-2 text-center">
        {current.detail && <p className="text-3xl font-black text-gold">{current.detail}</p>}
        <p className="text-6xl font-black" style={{ color: current.ink }}>{current.prompt}</p>
      </div>
      <div className={clsx("grid gap-2", current.choices.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {current.choices.map((label, choice) => (
          <button key={choice} disabled={locked} onPointerDown={() => answer(choice)} className="rounded-xl bg-panel py-8 text-2xl font-bold active:bg-line disabled:opacity-40">
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
