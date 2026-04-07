import os
import subprocess
import shutil
import time

def main():
    print("==================================================")
    print(" SOVEREIGN MEDIA - ADB COVER PUSH ORCHESTRATOR    ")
    print("==================================================")
    
    appdata = os.getenv("APPDATA")
    source_dir = os.path.join(appdata, "sovereign-media", "covers")
    tmp_dest = "/data/local/tmp/offline_covers"
    app_dest = "/data/user/0/com.sovereignaudio/files/offline_covers"
    package = "com.sovereignaudio"

    if not os.path.exists(source_dir):
        print(f"[!] Source directory not found: {source_dir}")
        return

    files = [f for f in os.listdir(source_dir) if f.endswith(('.jpg', '.png'))]
    print(f"[*] Found {len(files)} covers to inject via ADB.")
    if len(files) == 0:
        return

    # 1. Clean tmp
    print("\n[*} Cleaning temporary bridge...")
    subprocess.run(["adb", "shell", "rm", "-rf", tmp_dest], capture_output=True)
    subprocess.run(["adb", "shell", "mkdir", "-p", tmp_dest], capture_output=True)

    # 2. Push to tmp (adb shell user has permission here)
    print("[*] Flushing covers to device bridge...")
    start_time = time.time()
    res = subprocess.run(["adb", "push", f"{source_dir}\\.", tmp_dest], capture_output=True, text=True)
    if res.returncode != 0:
        print("[!] ADB Push Failed.")
        print(res.stderr)
        return
    print(f"[*] Injected in {round(time.time() - start_time, 2)}s")

    # Fix permissions so run-as can access it
    subprocess.run(["adb", "shell", "chmod", "-R", "777", tmp_dest], capture_output=True)

    # 3. Mount as the app user and copy from tmp into the secure DocumentDirectory
    print("[*] Migrating payload into secure Sovereign App sandbox...")
    # Ensure offline_covers exists internally
    subprocess.run(["adb", "shell", "run-as", package, "mkdir", "-p", "files/offline_covers"], check=True)
    
    # Copy files
    cp_cmd = ["adb", "shell", "run-as", package, "cp", "-R", f"{tmp_dest}/.", "files/offline_covers/"]
    res2 = subprocess.run(cp_cmd, capture_output=True, text=True)
    
    if res2.returncode == 0:
        print("[✔] MIGRATION COMPLETE! All covers safely locked in device flash storage.")
    else:
        print("[!] Migration Error:")
        print(res2.stderr)

    # Cleanup tmp
    print("[*] Scrubbing temporary bridge...")
    subprocess.run(["adb", "shell", "rm", "-rf", tmp_dest], capture_output=True)

if __name__ == "__main__":
    main()
