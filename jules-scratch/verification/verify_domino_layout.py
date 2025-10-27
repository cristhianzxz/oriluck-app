
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:5173/domino/test-game-id")
    page.wait_for_selector("text=Esperando jugadores", timeout=60000)
    page.screenshot(path="jules-scratch/verification/domino_layout.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
