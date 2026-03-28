# Election Protocols Experiments

TODO

## Info for running ocr_gemini_tests.py

```
python elections/protocols/backend/election-protocols-experiments/ocr_gemini_tests.py \
  ./data/chandra_output_per_page/122400005.0 \
  --output data/gemini_final_output/result_122400005.0.json
```

## Info for running compare_results.py

You need to download gt to compare.
Path for the result depends on where you saved it from prev step
```
python compare_results.py data/gt/122400005.0_gt.json data/gemini_final_output/result_122400005.0.json
python compare_results.py data/gt/122900056.0_gt.json data/gemini_final_output/result_122900056.0.json
```