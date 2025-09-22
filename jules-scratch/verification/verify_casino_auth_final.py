import re
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    try:
        # --- Go to page ---
        page.goto("http://localhost:5173/")

        # --- Registration and Redirection ---
        # Go to register form
        page.get_by_role("button", name="Registrarme").click()

        # Fill out the registration form
        page.get_by_placeholder("Usuario").fill("casino_test_user")
        page.get_by_placeholder("Correo").fill("casino_test@example.com")
        page.get_by_placeholder("Número de teléfono").fill("5555555")
        page.get_by_placeholder("Contraseña").fill("password123")
        page.get_by_role("checkbox").check()
        page.get_by_role("button", name="Registrarme").click()

        # Assert redirection to lobby after registration
        expect(page).to_have_url(re.compile(r'.*/lobby'), timeout=15000)
        print("✅ Registration successful, redirected to /lobby.")

        # Assert lobby content is visible
        expect(page.get_by_role("heading", name="Bienvenido al Lobby de Juegos")).to_be_visible()
        print("✅ Lobby content is visible after registration.")
        page.screenshot(path="jules-scratch/verification/01_lobby_after_register.png")

        # --- Logout Test ---
        page.get_by_role("button", name="Cerrar Sesión").click()

        # Assert redirection back to login page
        expect(page.get_by_role("heading", name="Iniciar Sesión")).to_be_visible(timeout=5000)
        print("✅ Logout successful, redirected to login page.")

        # --- Login Test ---
        page.get_by_placeholder("Correo").fill("casino_test@example.com")
        page.get_by_placeholder("Contraseña").fill("password123")
        page.get_by_role("button", name="Iniciar Sesión").click()

        # Assert redirection to lobby again
        expect(page).to_have_url(re.compile(r'.*/lobby'), timeout=10000)
        print("✅ Login successful again, redirected to /lobby.")

        expect(page.get_by_role("heading", name="Bienvenido al Lobby de Juegos")).to_be_visible()
        page.screenshot(path="jules-scratch/verification/verification.png")

        print("✅ Verification script completed successfully.")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error.png")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
