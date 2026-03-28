import os
import json
import argparse
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

# ---------------------------------------------------------------------------
# JSON Schema (empty template)
# ---------------------------------------------------------------------------

EMPTY_SCHEMA = {
    "sik_no": None,
    "voter_count": None,
    "additional_voter_count": None,
    "registered_votes": None,
    "paper_ballots": {
        "total": None,
        "unused_ballots": None,
        "registered_vote": None,
        "invalid_out_of_the_box": None,
        "invalid_in_the_box": None,
        "support_noone": None,
        "votes": [],
        "total_valid_votes": None
    },
    "machine_ballots": {
        "total_votes": None,
        "support_noone": None,
        "total_valid_votes": None,
        "votes": []
    }
}

SCHEMA_DESCRIPTION = """{
  "sik_no": int,                        // the topmost number in the squares
  "voter_count": int,                   // брой на избирателите - точка 1)
  "additional_voter_count": int,        // избиратели под чертата - точка 2)
  "registered_votes": int,              // избирателите според положените подписи - точка 3)
  "paper_ballots": {
    "total": int,                       // брой на получените бюлетини - точка А
    "unused_ballots": int,              // точка 4а
    "registered_vote": int,            // намерените бюлетини в кутията - точка 5)
    "invalid_out_of_the_box": int,     // недействителни бюлетини за образци - точка 4б
    "invalid_in_the_box": int,         // недействителни бюлетини в кутията - точка 6)
    "support_noone": int,
    "votes": [
      {
        "party_number": int,            // номера на партията
        "votes": int,                   // гласове без преференции - точка 8
        "preferences": [               // точка 10
          { "candidate_number": int, "count": int }
        ],
        "no_preferences": int          // без преференция - точка 10
      }
    ],
    "total_valid_votes": int           // общ брой действителни гласове - точка 9
  },
  "machine_ballots": {
    "total_votes": int,                // машинно гласуване - точка 11
    "support_noone": int,             // не подкрепям никого - точка 12
    "total_valid_votes": int,         // точка 14
    "votes": [
      {
        "party_number": int,           // номер на партията - точка 13
        "votes": int,                  // действителни гласове - точка 13
        "preferences": [              // точка 15
          { "candidate_number": int, "count": int }
        ],
        "no_preferences": int
      }
    ]
  }
}"""

def main():
    # 1. Setup CLI Arguments
    parser = argparse.ArgumentParser(description="Batch process PDF election protocols with Gemini OCR")
    parser.add_argument("-i", "--input", required=True, help="Path to the folder containing PDF files")
    parser.add_argument("-o", "--output", required=True, help="Path to the folder to save JSON outputs")
    parser.add_argument("-m", "--model", default="gemini-2.5-flash", help="Gemini model to use (default: gemini-2.5-flash)")
    args = parser.parse_args()

    # 2. Setup Paths
    input_folder = Path(args.input)
    output_folder = Path(args.output)
    output_folder.mkdir(parents=True, exist_ok=True)

    if not input_folder.is_dir():
        print(f"Error: Input folder '{input_folder}' does not exist.")
        return

    # 3. Initialize Gemini Client
    load_dotenv()
    if not os.getenv("GEMINI_API_KEY"):
        print("Error: GEMINI_API_KEY not found. Make sure you have a .env file.")
        return
        
    client = genai.Client()

    # 4. Define the Prompt (Updated to process the attached PDF natively)
    prompt = f"""Ти си експерт по изборни одити. Анализираш прикачения сканиран PDF протокол.

Ето празен JSON шаблон, който трябва да попълниш:
{json.dumps(EMPTY_SCHEMA, indent=2)}

Ето схемата с описания на полетата:
{SCHEMA_DESCRIPTION}

Инструкции:
1. Извлечи данните от прикачения PDF протокол и ги нанеси в JSON структурата.
2. Ако дадено число е задраскано, поправено или неразбираемо, върни -1.
3. Ако полето изобщо не присъства или не е намерено в протокола, остави го null.
4. Върни САМО валиден JSON без допълнителни обяснения, маркдаун блокове (```json) или друг текст."""

    # 5. Process Files
    pdf_files = list(input_folder.glob("*.pdf"))
    if not pdf_files:
        print(f"No PDF files found in {input_folder}")
        return
        
    print(f"Found {len(pdf_files)} PDFs to process using model: {args.model}\n")

    for pdf_path in pdf_files:
        print(f"Processing: {pdf_path.name}...")
        uploaded_file = None
        
        try:
            # Upload the whole PDF
            uploaded_file = client.files.upload(file=str(pdf_path))
            
            # Run Inference
            response = client.models.generate_content(
                model=args.model, 
                contents=[uploaded_file, prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", 
                    temperature=0.0
                )
            )
            
            # Save the JSON output
            output_file_path = output_folder / f"{pdf_path.stem}.json"
            with open(output_file_path, "w", encoding="utf-8") as f:
                f.write(response.text)
                
            print(f"Saved to {output_file_path.name}")

        except Exception as e:
            print(f"Failed to process {pdf_path.name}. Error: {e}")
            
        finally:
            # Clean up the file from Google's servers
            if uploaded_file:
                try:
                    client.files.delete(name=uploaded_file.name)
                except Exception as cleanup_error:
                    print(f"Warning: Could not delete {uploaded_file.name}: {cleanup_error}")
        
        # Rate Limiting Pause (Skip delay on the very last file)
        if pdf_path != pdf_files[-1]:
            time.sleep(3)

    print("\nBatch processing complete!")

if __name__ == "__main__":
    main()