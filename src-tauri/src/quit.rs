//! Native quit watchdog. Only the initial UI acknowledgement has a deadline;
//! a visible prompt may wait indefinitely, and another quit always exits.

mod core {
    use std::time::Duration;

    pub const DEADLINE: Duration = Duration::from_secs(2);

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum State {
        Idle,
        Asking { id: u32, since: Duration },
        Prompting { id: u32 },
    }

    #[derive(Debug, Clone, Copy)]
    pub enum Answer {
        Go,
        Prompting,
    }

    #[derive(Debug, Clone, Copy)]
    pub enum Event {
        QuitRequested(Duration),
        UiAnswer { id: u32, answer: Answer },
        UiConfirm { id: u32 },
        UiCancel { id: u32 },
        Tick(Duration),
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum Effect {
        None,
        AskUi { id: u32 },
        Exit,
    }

    pub struct Machine {
        pub state: State,
        next_id: u32,
        exited: bool,
    }

    impl Default for Machine {
        fn default() -> Self {
            Self {
                state: State::Idle,
                next_id: 0,
                exited: false,
            }
        }
    }

    impl Machine {
        pub fn handle(&mut self, event: Event) -> Effect {
            if self.exited {
                return Effect::None;
            }
            let active_id = match self.state {
                State::Idle => None,
                State::Asking { id, .. } | State::Prompting { id } => Some(id),
            };
            let effect = match event {
                Event::QuitRequested(now) => match self.state {
                    State::Idle => {
                        // Never reuse an id, even after cancellation. If exhausted,
                        // exit rather than accepting an old UI response.
                        let Some(id) = self.next_id.checked_add(1) else {
                            self.exited = true;
                            return Effect::Exit;
                        };
                        self.next_id = id;
                        self.state = State::Asking { id, since: now };
                        Effect::AskUi { id }
                    }
                    _ => Effect::Exit,
                },
                Event::UiAnswer { id, answer } if active_id == Some(id) => match answer {
                    Answer::Go => Effect::Exit,
                    Answer::Prompting => {
                        self.state = State::Prompting { id };
                        Effect::None
                    }
                },
                Event::UiConfirm { id } if active_id == Some(id) => Effect::Exit,
                Event::UiCancel { id } if active_id == Some(id) => {
                    self.state = State::Idle;
                    Effect::None
                }
                Event::Tick(now) => match self.state {
                    State::Asking { since, .. } if now.saturating_sub(since) >= DEADLINE => {
                        Effect::Exit
                    }
                    _ => Effect::None,
                },
                _ => Effect::None,
            };
            if effect == Effect::Exit {
                self.exited = true;
            }
            effect
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        const START: Duration = Duration::from_secs(10);

        fn asking() -> Machine {
            let mut machine = Machine::default();
            assert_eq!(machine.state, State::Idle);
            assert_eq!(
                machine.handle(Event::QuitRequested(START)),
                Effect::AskUi { id: 1 }
            );
            assert_eq!(
                machine.state,
                State::Asking {
                    id: 1,
                    since: START
                }
            );
            machine
        }

        fn prompting() -> Machine {
            let mut machine = asking();
            assert_eq!(
                machine.handle(Event::UiAnswer {
                    id: 1,
                    answer: Answer::Prompting
                }),
                Effect::None
            );
            assert_eq!(machine.state, State::Prompting { id: 1 });
            machine
        }

        #[test]
        fn idle_ignores_ticks_and_unsolicited_ui_events() {
            let mut machine = Machine::default();
            for event in ui_events(1).into_iter().chain([Event::Tick(START)]) {
                assert_eq!(machine.handle(event), Effect::None);
                assert_eq!(machine.state, State::Idle);
            }
        }

        fn ui_events(id: u32) -> [Event; 4] {
            [
                Event::UiAnswer {
                    id,
                    answer: Answer::Go,
                },
                Event::UiAnswer {
                    id,
                    answer: Answer::Prompting,
                },
                Event::UiConfirm { id },
                Event::UiCancel { id },
            ]
        }

        #[test]
        fn go_and_confirm_exit_with_the_current_id() {
            for mut machine in [asking(), prompting()] {
                assert_eq!(machine.handle(ui_events(1)[0]), Effect::Exit);
            }
            for mut machine in [asking(), prompting()] {
                assert_eq!(machine.handle(Event::UiConfirm { id: 1 }), Effect::Exit);
            }
        }

        #[test]
        fn second_quit_exits_while_asking_or_prompting() {
            for mut machine in [asking(), prompting()] {
                assert_eq!(machine.handle(Event::QuitRequested(START)), Effect::Exit);
            }
        }

        #[test]
        fn asking_times_out_at_two_seconds_but_not_at_1990_ms() {
            let mut machine = asking();
            assert_eq!(
                machine.handle(Event::Tick(START + Duration::from_millis(1990))),
                Effect::None
            );
            assert_eq!(machine.handle(Event::Tick(START + DEADLINE)), Effect::Exit);
        }

        #[test]
        fn a_tick_after_the_deadline_also_exits() {
            assert_eq!(
                asking().handle(Event::Tick(START + Duration::from_secs(3))),
                Effect::Exit
            );
        }

        #[test]
        fn prompting_has_no_timeout_and_repeated_acknowledgement_is_harmless() {
            let mut machine = prompting();
            assert_eq!(machine.handle(ui_events(1)[1]), Effect::None);
            assert_eq!(machine.handle(Event::Tick(Duration::MAX)), Effect::None);
            assert_eq!(machine.state, State::Prompting { id: 1 });
        }

        #[test]
        fn stale_ids_cannot_change_an_active_request() {
            for mut machine in [asking(), prompting()] {
                let before = machine.state;
                for id in [0, 2] {
                    for event in ui_events(id) {
                        assert_eq!(machine.handle(event), Effect::None);
                        assert_eq!(machine.state, before);
                    }
                }
            }
        }

        #[test]
        fn cancel_then_quit_asks_again_with_a_fresh_id_and_deadline() {
            for mut machine in [asking(), prompting()] {
                assert_eq!(machine.handle(Event::UiCancel { id: 1 }), Effect::None);
                assert_eq!(machine.state, State::Idle);
                assert_eq!(machine.handle(Event::Tick(Duration::MAX)), Effect::None);
                let now = START + Duration::from_secs(1);
                assert_eq!(
                    machine.handle(Event::QuitRequested(now)),
                    Effect::AskUi { id: 2 }
                );
                assert_eq!(machine.state, State::Asking { id: 2, since: now });
                for event in ui_events(1) {
                    assert_eq!(machine.handle(event), Effect::None);
                }
                // A timer from the cancelled request cannot exit this one early.
                assert_eq!(machine.handle(Event::Tick(START + DEADLINE)), Effect::None);
                assert_eq!(machine.handle(Event::Tick(now + DEADLINE)), Effect::Exit);
            }
        }

        #[test]
        fn exit_is_idempotent_for_every_exit_path() {
            for event in [
                Event::QuitRequested(START),
                ui_events(1)[0],
                Event::UiConfirm { id: 1 },
                Event::Tick(START + DEADLINE),
            ] {
                let mut machine = asking();
                assert_eq!(machine.handle(event), Effect::Exit);
                for later in ui_events(1)
                    .into_iter()
                    .chain([Event::QuitRequested(START), Event::Tick(Duration::MAX)])
                {
                    assert_eq!(machine.handle(later), Effect::None);
                }
            }
        }
    }
}

use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};

use self::core::{Answer, Effect, Event, Machine, DEADLINE};
use crate::SHELL_WEBVIEW;

pub struct QuitState {
    origin: Instant,
    machine: Mutex<Machine>,
}

impl Default for QuitState {
    fn default() -> Self {
        Self {
            origin: Instant::now(),
            machine: Mutex::new(Machine::default()),
        }
    }
}

#[derive(Clone, Serialize)]
struct QuitRequest {
    id: u32,
}

fn feed<R: Runtime>(app: &AppHandle<R>, event: Event) {
    let state = app.state::<QuitState>();
    let effect = state
        .machine
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .handle(event);
    // Release the machine lock before emitting, spawning or exiting.
    match effect {
        Effect::None => {}
        Effect::Exit => app.exit(0),
        Effect::AskUi { id } => {
            let timer_app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(DEADLINE).await;
                let now = timer_app.state::<QuitState>().origin.elapsed();
                feed(&timer_app, Event::Tick(now));
            });
            if let Err(err) = app.emit_to(
                EventTarget::webview(SHELL_WEBVIEW),
                "shell://quit-request",
                QuitRequest { id },
            ) {
                log::warn!("quit request not delivered; watchdog will exit: {err}");
            }
        }
    }
}

pub fn request<R: Runtime>(app: &AppHandle<R>) {
    let now = app.state::<QuitState>().origin.elapsed();
    feed(app, Event::QuitRequested(now));
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuitAnswer {
    Go,
    Prompting,
}

#[tauri::command]
pub fn quit_answer<R: Runtime>(app: AppHandle<R>, id: u32, answer: QuitAnswer) {
    let answer = match answer {
        QuitAnswer::Go => Answer::Go,
        QuitAnswer::Prompting => Answer::Prompting,
    };
    feed(&app, Event::UiAnswer { id, answer });
}

#[tauri::command]
pub fn quit_confirm<R: Runtime>(app: AppHandle<R>, id: u32) {
    feed(&app, Event::UiConfirm { id });
}

#[tauri::command]
pub fn quit_cancel<R: Runtime>(app: AppHandle<R>, id: u32) {
    feed(&app, Event::UiCancel { id });
}
