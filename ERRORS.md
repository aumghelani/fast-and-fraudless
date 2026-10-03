# Error log (symptom → cause → fix → status)

| ID | When | Symptom | Cause | Fix | Status |
|---|---|---|---|---|---|
| E-001 | setup | `mongo:8.0` container restart-loops: "Linux kernel versions 6.19 and newer has a known incompatibility" | MongoDB SERVER-121912 (tcmalloc rseq) vs GB10 kernel `7.0.0-1019-nvidia`. `mongo:latest` too | use **`mongo:8.2`** (8.2.12 verified) | fixed |
| E-002 | setup | `docker info` shows no `nvidia` runtime | box uses CDI (`/var/run/cdi/nvidia.yaml`) | none needed: `docker run --gpus all ubuntu nvidia-smi -L` sees GB10. Do NOT run `nvidia-ctk runtime configure` (restarts all containers) | n/a |
| E-003 | setup | Windows `ssh` refuses: "Bad owner or permissions on .ssh/config" | ACL on existing laptop config file | use `ssh -F NUL` (PowerShell) / `-F /dev/null` (bash); don't touch the user's config | worked around |
| E-004 | setup | direct ethernet: no carrier with 2 cables; then link at only 100 Mbps; SSH to 169.254.x timed out | (a) cable seating; (b) Windows routed 169.254/16 via VMware VMnet1 | bind source: `ssh -b 169.254.33.215 dell@169.254.236.88` | worked around (11.7 MB/s) |
| E-005 | prep | transformers Parakeet: `ParakeetFeatureExtractor requires the librosa library` | librosa not in the vLLM image | `pip install --no-index --find-links ~/tw/wheels/py312-aarch64-asr librosa` | fixed (wheels prepared) |
| E-006 | prep | Parakeet silently dropped a sentence from a 58 s clip | long-form audio in one pass | transcribe ≤10–15 s windows | design rule |
| E-007 | setup | box clock 1 h behind | timezone set to Central | `sudo timedatectl set-timezone America/New_York` | fixed |
| E-008 | build | WIP files of one builder appeared inside another builder's commits (validator.py in 5275578/62aad41; scripts/asr_up.sh in 60a2fc7) | several builders share one working tree; `git add -A` or a plain `git commit` takes everything staged by anyone | commit only your own paths: `git commit -m "..." -- path1 path2` | process rule |
| E-009 | build | regex word boundary written as a backspace char (0x08) in validator.py, so the aggregate-keyword check never matched | file patched through a bash heredoc on the Windows laptop; the tool layer collapsed the double backslash | edit Python with the editor, not heredocs; `grep -P "\x08" -r backend` should print nothing | fixed |
