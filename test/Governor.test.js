const {
  getNamedAccounts,
  deployments,
  ethers,
  network,
  hardhatArguments,
} = require("hardhat")
const {
  developmentChains,
  governorName,
  votingDelay,
  votingPeriod,
  proposalThreshold,
  quorumPercent,
  func,
} = require("../helper-hardhat-config")
const { assert, expect } = require("chai")
const {
  isCallTrace,
} = require("hardhat/internal/hardhat-network/stack-traces/message-trace")

const { mine } = require("@nomicfoundation/hardhat-network-helpers")

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Governor Contract Tests", async function () {
      let TimeLock,
        MyGovernor,
        Treasury,
        deployer,
        user,
        user2,
        emptyBytes,
        encodedFunctionCall,
        GovernanceToken
      beforeEach(async function () {
        deployer = (await getNamedAccounts()).deployer
        user = (await getNamedAccounts()).user
        user2 = (await getNamedAccounts()).user2

        await deployments.fixture()

        TimeLock = await ethers.getContract("TimeLock", deployer)

        MyGovernor = await ethers.getContract("MyGovernor", deployer)

        Treasury = await ethers.getContract("Treasury", deployer)

        GovernanceToken = await ethers.getContract("GovernanceToken", deployer)

        const ethersToTransfer = ethers.utils.parseEther("1")
        encodedFunctionCall = Treasury.interface.encodeFunctionData(func, [
          user2,
          ethersToTransfer,
        ])

        GovernanceToken = await ethers.getContract("GovernanceToken", deployer)
      })

      describe("Constructor Tests", async function () {
        it("Name is Correct", async function () {
          const nameofGovernor = await MyGovernor.name()
          assert.equal(governorName, governorName)
        })

        it("Token Contract Address is Correct", async function () {
          const token = await MyGovernor.token()
          assert.equal(token, GovernanceToken.address)
        })

        it("Timelock Contract Address is Correct", async function () {
          const timelock = await MyGovernor.timelock()
          assert.equal(timelock, TimeLock.address)
        })

        it("Voting Delay is correctly set ", async function () {
          const votingDelayFromContract = await MyGovernor.votingDelay()
          assert.equal(votingDelayFromContract, votingDelay)
        })

        it("Voting Period is correctly set ", async function () {
          const votingPeriodFromContract = await MyGovernor.votingPeriod()
          assert.equal(votingPeriodFromContract, votingPeriod)
        })

        it("Proposal Threshold is correctly set ", async function () {
          const proposalThresholdFromContract =
            await MyGovernor.proposalThreshold()
          assert.equal(proposalThresholdFromContract, proposalThreshold)
        })
      })

      describe("Modify Governance", async function () {
        it("Proposal Threshold Cannot be Modified by deployer", async function () {
          await expect(MyGovernor.setProposalThreshold(2)).to.be.revertedWith(
            "Governor: onlyGovernance"
          )
        })
        it("Voting Delay Cannot be Modified by deployer", async function () {
          await expect(MyGovernor.setVotingDelay(2)).to.be.revertedWith(
            "Governor: onlyGovernance"
          )
        })
        it("Voting Period Cannot be Modified by deployer", async function () {
          await expect(MyGovernor.setVotingPeriod(2)).to.be.revertedWith(
            "Governor: onlyGovernance"
          )
        })
      })

      describe("Propose", async function () {
        it("Proposal CANNOT be entered by anyone NOT meeting proposal threshold", async function () {
          await expect(
            MyGovernor.propose(
              [Treasury.address],
              [0],
              [encodedFunctionCall],
              "This is a Proposal to release funds to the user"
            )
          ).to.be.revertedWith(
            "Governor: proposer votes below proposal threshold"
          )
        })

        it("Proposal can be entered by the one meeting proposal threshold", async function () {
          const nftMinted = await GovernanceToken.mintNFT(deployer, 1)
          const delegate = await GovernanceToken.delegate(
            deployer
          ) /* Votes not counted till they are delegated */

          await expect(
            MyGovernor.propose(
              [Treasury.address],
              [0],
              [encodedFunctionCall],
              "This is a Proposal to release funds to the user"
            )
          ).to.be.ok
        })
      })

      describe("Proposal Attributes", async function () {
        let proposalId
        beforeEach(async function () {
          const nftMinted = await GovernanceToken.mintNFT(deployer, 1)
          const delegate = await GovernanceToken.delegate(
            deployer
          ) /* Votes not counted till they are delegated */

          const propose = await MyGovernor.propose(
            [Treasury.address],
            [0],
            [encodedFunctionCall],
            "This is a Proposal to release funds to the user"
          )

          const proposed = await propose.wait()
          proposalId = proposed.events[0].args[0].toString()
        })

        it("Proposal Start is correctly set", async function () {
          const ProposalBlock = await ethers.provider.getBlock("latest")

          const proposalSnapshot = await MyGovernor.proposalSnapshot(proposalId)
          assert.equal(
            proposalSnapshot.toString(),
            (ProposalBlock.number + votingDelay).toString()
          )
        })

        it("Proposal Deadline is correctly set", async function () {
          const ProposalBlock = await ethers.provider.getBlock("latest")

          const proposalDeadline = await MyGovernor.proposalDeadline(proposalId)
          assert.equal(
            proposalDeadline.toString(),
            (ProposalBlock.number + votingDelay + votingPeriod).toString()
          )
        })

        it("Proposal votes are set as 0 initially", async function () {
          const ProposalVotes = await MyGovernor.proposalVotes(proposalId)
          let sum = 0
          ProposalVotes.forEach((element) => {
            sum += parseInt(element)
          })

          assert.equal(sum, 0)
        })

        it("Proposal state is set as 0 (Pending) initially ", async function () {
          const ProposalState = await MyGovernor.state(proposalId)
          // 0 Pending,
          // 1 Active,
          // 2 Canceled,
          // 3 Defeated,
          // 4 Succeeded,
          // 5 Queued,
          // 6 Expired,
          // 7 Executed
          await hre.network.provider.send("hardhat_mine", ["0x100"])
          assert.equal(ProposalState, 0)
        })

        it("Proposal state is set as 1 (Active) after voting delay is complete ", async function () {
          for (let i = 0; i < votingDelay + 1; i++) {
            await ethers.provider.send("evm_mine")
          }
          const ProposalState = await MyGovernor.state(proposalId)
          // 0 Pending,
          // 1 Active,
          // 2 Canceled,
          // 3 Defeated,
          // 4 Succeeded,
          // 5 Queued,
          // 6 Expired,
          // 7 Executed
          assert.equal(ProposalState, 1)
        })
      })

      describe("Proposal Voting", async function () {
        let proposalId
        beforeEach(async function () {
          const nftMinted_2 = await GovernanceToken.mintNFT(user, 2)
          const delegate_2 = await GovernanceToken.delegate(
            user
          ) /* Votes not counted till they are delegated */

          const nftMinted = await GovernanceToken.mintNFT(deployer, 1)
          const delegate = await GovernanceToken.delegate(
            deployer
          ) /* Votes not counted till they are delegated */

          const propose = await MyGovernor.propose(
            [Treasury.address],
            [0],
            [encodedFunctionCall],
            "This is a Proposal to release funds to the user"
          )

          const proposed = await propose.wait()
          proposalId = proposed.events[0].args[0].toString()
        })

        it("No Votes for address which has no NFT", async function () {
          const currentBlock = await ethers.provider.getBlock("latest")
          await ethers.provider.send("evm_mine")
          const votes = await MyGovernor.getVotes(user2, currentBlock.number)
          const ownerOf = await GovernanceToken.balanceOf(user2)
          assert.equal(votes.toString(), "0")
          assert.equal(ownerOf.toString(), "0")
        })

        it("Votes returned for address which has NFT", async function () {
          const nftMinted = await GovernanceToken.mintNFT(user2, 3)
          const delegate = await GovernanceToken.delegate(
            user2
          ) /* Votes not counted till they are delegated */

          const currentBlock = await ethers.provider.getBlock("latest")
          await ethers.provider.send("evm_mine")
          const votes = await MyGovernor.getVotes(user2, currentBlock.number)
          const ownerOf = await GovernanceToken.balanceOf(user2)
          assert.equal(votes.toString(), "1")
          assert.equal(ownerOf.toString(), "1")
        })

        it("Cannot Cast Vote if Proposal is pending", async function () {
          const proposalState = await MyGovernor.state(proposalId)
          assert.equal(proposalState.toString(), "0") // Proposal State is Pending
          // In Progress
        })
      })
    })
