import re
from playwright.sync_api import sync_playwright, Page, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # 1. Navigate to the login page
        page.goto("http://localhost:5173/")

        # Debugging: take a screenshot to see the initial state
        page.screenshot(path="jules-scratch/verification/debug_initial_page.png")
        print("Initial page screenshot taken for debugging.")

        # 2. Click login button to show the form
        page.get_by_role("button", name="🚀 Iniciar Sesión").click()

        # 3. Fill in credentials and log in
        page.get_by_placeholder("📧 Correo electrónico").fill("prueba2@hotmail.com")
        page.get_by_placeholder("🔒 Contraseña").fill("123456")
        page.get_by_role("button", name="🎯 Ingresar a mi Cuenta").click()

        # Wait for navigation to the lobby, which indicates a successful login
        expect(page).to_have_url(re.compile(r".*/lobby"))
        print("Login successful, navigated to lobby.")

        # 4. Navigate to the Crash game page
        page.goto("http://localhost:5173/crash")
        print("Navigated to Crash game page.")

        # 5. Verify UI changes
        header = page.get_by_role("heading", name="🚀 ASCENSO ESTELAR")
        expect(header).to_be_visible()

        # Check that the old text is not present
        expect(page.get_by_text("| NASA Neon")).not_to_be_visible()
        print("Header text verified.")

        # Check that the "Volver al Lobby" button exists
        lobby_button = page.get_by_role("button", name="Volver al Lobby")
        expect(lobby_button).to_be_visible()
        print("Lobby button verified.")

        # 6. Take a screenshot for visual verification
        screenshot_path = "jules-scratch/verification/crash_game_verification.png"
        page.screenshot(path=screenshot_path, full_page=True)
        print(f"Screenshot saved to {screenshot_path}")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)