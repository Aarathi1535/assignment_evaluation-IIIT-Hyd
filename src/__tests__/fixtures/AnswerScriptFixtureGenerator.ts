import { RawPageRegionInput } from '../../services/segmentation/ContinuationReconstructionEngine';

/**
 * AnswerScriptFixtureGenerator
 * 
 * Provides deterministic synthetic multi-page answer sheet fixtures for validating
 * question-answer association, non-consecutive continuations, out-of-order responses,
 * shared pages, diagrams, and ambiguity handling.
 */
export class AnswerScriptFixtureGenerator {
    /**
     * Scenario 1: Consecutive Continuation
     * Q1 starts on Page 1 and cleanly continues on Page 2.
     */
    static createConsecutiveContinuationFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Q1: State and prove the divergence theorem in 3D Euclidean space. Let V be a volume bounded by surface S.'
            },
            {
                pageNumber: 2,
                text: 'Applying Gauss divergence formula to each differential prism, we integrate over volume V to complete Q1.'
            }
        ];
    }

    /**
     * Scenario 2: Distal Continuation (Prof. Jawahar Core Example)
     * Q1 on Page 1; Q2 on Page 2; Q3 on Page 3; Q1 continued on Page 7.
     */
    static createDistalContinuationFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Q1: Compute the eigenvalues of matrix A = [[3, 1], [0, 2]]. Characteristic polynomial is det(A - lambda*I) = 0.'
            },
            {
                pageNumber: 2,
                text: 'Q2: Define a deterministic finite automaton (DFA) M = (Q, Sigma, delta, q0, F). State transition table is given by:'
            },
            {
                pageNumber: 3,
                text: 'Q3: Explain the working of Dijkstra algorithm with priority queue time complexity O((V+E) log V).'
            },
            {
                pageNumber: 4,
                text: 'Q4: QuickSort average time complexity recurrence relation T(n) = 2T(n/2) + O(n).'
            },
            {
                pageNumber: 5,
                text: 'Q5: Dynamic programming solution for 0/1 knapsack problem with memoization table.'
            },
            {
                pageNumber: 6,
                text: 'Q6: Relational algebra projection and selection queries on student database.'
            },
            {
                pageNumber: 7,
                text: 'Q1 continued: Resuming eigenvalue calculation from Page 1: (3 - lambda)(2 - lambda) = 0, so lambda_1 = 3, lambda_2 = 2.'
            }
        ];
    }

    /**
     * Scenario 3: Triple Non-Consecutive Pages
     * Q1 starts on Page 1, resumes on Page 4, and concludes on Page 9.
     */
    static createTripleNonConsecutiveFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Question 1: Part 1 - Derivation of Navier-Stokes continuity equation. Let rho be density and u be velocity field.'
            },
            {
                pageNumber: 2,
                text: 'Question 2: Heat conduction equation in cylindrical coordinates.'
            },
            {
                pageNumber: 3,
                text: 'Question 3: Bernoulli equation application for venturi meter.'
            },
            {
                pageNumber: 4,
                text: 'Q1 contd: Part 2 - Expanding substantial derivative D(rho)/Dt + rho*(div u) = 0.'
            },
            {
                pageNumber: 5,
                text: 'Question 4: Fourier transform of Gaussian pulse.'
            },
            {
                pageNumber: 9,
                text: 'Q1 continued: Part 3 - Final boundary conditions applied at walls yielding steady state flow.'
            }
        ];
    }

    /**
     * Scenario 4: Multiple Questions on Same Page
     * Page 3 contains bottom of Q1 and start of Q2 with distinct bounding boxes.
     */
    static createSharedPageFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Q1: Write merge sort algorithm in pseudo-code.'
            },
            {
                pageNumber: 2,
                text: 'MergeSort step 1: Divide array of size n into two sub-arrays of size n/2.'
            },
            {
                pageNumber: 3,
                box: { x: 0.05, y: 0.05, width: 0.9, height: 0.4 },
                text: 'Q1 contd: Combine step merges sorted lists in linear time O(n).'
            },
            {
                pageNumber: 3,
                box: { x: 0.05, y: 0.5, width: 0.9, height: 0.45 },
                text: 'Q2: Explain binary heap property and array index formula 2i and 2i+1.'
            }
        ];
    }

    /**
     * Scenario 5: Out-of-Order Answering
     * Student answers Q3 on Page 1, Q1 on Page 2, Q5 on Page 3, Q2 on Page 4, Q1 contd on Page 5.
     */
    static createOutOfOrderFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Ans 3: Balanced binary search trees ensure O(log n) search, insertion, and deletion.'
            },
            {
                pageNumber: 2,
                text: 'Ans 1: Depth First Search uses stack recursion to explore vertices.'
            },
            {
                pageNumber: 3,
                text: 'Ans 5: Huffman coding builds optimal prefix trees based on character frequencies.'
            },
            {
                pageNumber: 4,
                text: 'Ans 2: Breadth First Search uses FIFO queue to find shortest path in unweighted graphs.'
            },
            {
                pageNumber: 5,
                text: 'Q1 continued: DFS cycle detection algorithm uses back-edges in directed graph.'
            }
        ];
    }

    /**
     * Scenario 6: Return to Earlier Question
     * Student answers Q1 on Page 1, Q2 on Page 2, and then writes Q1 header again on Page 3.
     */
    static createReturnToQuestionFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Question 1: Explain ACID properties in DBMS: Atomicity, Consistency, Isolation, Durability.'
            },
            {
                pageNumber: 2,
                text: 'Question 2: Explain Two-Phase Locking (2PL) protocol: Growing phase and shrinking phase.'
            },
            {
                pageNumber: 3,
                text: 'Question 1: Additional notes on Isolation levels: Read uncommitted, read committed, repeatable read, serializable.'
            }
        ];
    }

    /**
     * Scenario 7: Explicit Labelled Continuation Marker
     * Uses explicit phrase "Q1 continued" on Page 5.
     */
    static createExplicitLabelledContinuationFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Q1: P versus NP problem. Class P contains polynomial-time decision problems.'
            },
            {
                pageNumber: 5,
                text: 'Q1 continued: NP-complete problems can be reduced to each other via Karp polynomial reduction.'
            }
        ];
    }

    /**
     * Scenario 8: Unlabelled Continuation (Syntactic mid-sentence continuity)
     * Page 1 ends mid-sentence ("therefore the derivative of f(x) with respect to x is"),
     * Page 2 begins with formula ("= 2x * cos(x^2)").
     */
    static createUnlabelledSyntacticContinuationFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Q1: Compute the derivative of f(x) = sin(x^2). Applying chain rule, therefore the derivative of f(x) with respect to x is'
            },
            {
                pageNumber: 2,
                text: '= 2x * cos(x^2), which completes the differentiation.'
            }
        ];
    }

    /**
     * Scenario 9: Ambiguous Continuation
     * Q2 on Page 2, Q4 on Page 4. Page 6 contains unlabelled text that is not syntactically continuous.
     */
    static createAmbiguousContinuationFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Q1: Complete definition of TCP 3-way handshake.'
            },
            {
                pageNumber: 2,
                text: 'Q2: UDP header format: Source port, Destination port, Length, Checksum.'
            },
            {
                pageNumber: 4,
                text: 'Q4: Congestion control slow start and congestion avoidance phases.'
            },
            {
                pageNumber: 6,
                text: 'Window scaling option allows throughput over high-bandwidth latency product paths.'
            }
        ];
    }

    /**
     * Scenario 10: Unrelated / Scratch Sheet
     * Page 3 contains "Rough Work" or scratch notes.
     */
    static createScratchSheetFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Q1: Solve system of linear equations 2x + y = 5, x - y = 1.'
            },
            {
                pageNumber: 2,
                text: 'Rough Work / Scratch Sheet: trial calculation 5 * 12 = 60, ignore this page.'
            },
            {
                pageNumber: 3,
                text: 'Q1 continued: Adding equations yields 3x = 6, hence x = 2, y = 1.'
            }
        ];
    }

    /**
     * Scenario 11: Blank Page Handling
     * Page 2 is near-blank between Q1 (Page 1) and Q1 contd (Page 3).
     */
    static createBlankPageFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Q1: Memory hierarchy and caching principles: L1, L2, L3 cache.'
            },
            {
                pageNumber: 2,
                text: '',
                nearBlank: true
            },
            {
                pageNumber: 3,
                text: 'Q1 contd: Direct mapped vs set associative cache placement policies.'
            }
        ];
    }

    /**
     * Scenario 12: Diagram-Heavy Answer with Bounding Box
     * Q2 on Page 2 has text, Page 3 has a diagram bounding box.
     */
    static createDiagramAnswerFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 2,
                text: 'Q2: Design a 4-bit synchronous binary counter using JK flip-flops.'
            },
            {
                pageNumber: 3,
                box: { x: 0.1, y: 0.1, width: 0.8, height: 0.75 },
                text: '[Circuit Diagram: 4 JK Flip Flops with common clock and AND gate enable inputs]',
                isDiagram: true
            }
        ];
    }

    /**
     * Scenario 13: Similar Sub-Question Structures
     * Q1(a), Q1(b), Q2(a), Q2(b) sub-question hierarchy.
     */
    static createSubQuestionStructureFixture(): RawPageRegionInput[] {
        return [
            {
                pageNumber: 1,
                text: 'Question 1(a): Differentiate between process and thread.'
            },
            {
                pageNumber: 2,
                text: 'Question 1(b): Context switching overhead components.'
            },
            {
                pageNumber: 3,
                text: 'Question 2(a): Semaphores vs Mutex locks.'
            },
            {
                pageNumber: 4,
                text: 'Question 2(b): Producer-consumer bounded buffer solution.'
            }
        ];
    }
}
