import os
import sys

# ANSI Colors for Terminal
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
WHITE  = "\033[97m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def print_menu():
    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{WHITE}   PARKINSON'S MULTI-MODAL RESEARCH FRAMEWORK{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"  {YELLOW}[1]{RESET} STEP 1: Align Vocal & Motor Datasets (UPDRS Matching)")
    print(f"  {YELLOW}[2]{RESET} STEP 2: Train Baseline Model (Random Forest - Vocal Only)")
    print(f"  {YELLOW}[3]{RESET} STEP 3: Train Multi-Modal Fusion Model (CNN + MLP)")
    print(f"  {YELLOW}[4]{RESET} STEP 4: Generate Model Comparison Chart")
    print(f"  {YELLOW}[0]{RESET} Exit")
    print(f"{CYAN}{'-'*60}{RESET}")

def run_script(script_name):
    script_path = os.path.join("scripts", script_name)
    if not os.path.exists(script_path):
        print(f"{RED}Error: Cannot find {script_name} in 'scripts/'.{RESET}")
        return
    print(f"\n{BOLD}{GREEN}>>> Executing: {script_name}...{RESET}\n")
    exit_code = os.system(f'"{sys.executable}" {script_path}')
    if exit_code == 0:
        print(f"\n{BOLD}{GREEN}✅ Finished: {script_name}{RESET}")
    else:
        print(f"\n{BOLD}{RED}❌ {script_name} exited with an error.{RESET}")

def main():
    while True:
        print_menu()
        choice = input(f"{BOLD}Select an option (0-4): {RESET}").strip()

        if choice == '1':
            run_script("dataset_alignment.py")
        elif choice == '2':
            run_script("train_vocal.py")
        elif choice == '3':
            run_script("train_fusion.py")
        elif choice == '4':
            run_script("plot_comparison.py")
        elif choice == '0':
            print(f"{CYAN}Exiting. Goodbye!{RESET}")
            break
        else:
            print(f"{RED}Invalid choice. Please enter 0-4.{RESET}")

if __name__ == "__main__":
    main()